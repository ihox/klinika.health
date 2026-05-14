import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AllowAnonymous } from '../../common/decorators/allow-anonymous.decorator';
import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import { CreateDicomLinkSchema, OrthancEventSchema } from './dicom.dto';
import type {
  DicomLinkDto,
  DicomStudyDetailDto,
  DicomStudyDto,
} from './dicom.dto';
import { DicomService } from './dicom.service';
import { OrthancClient } from './orthanc.client';

/**
 * DICOM bridge endpoints.
 *
 *   Picker / detail:
 *     GET    /api/dicom/recent
 *     GET    /api/dicom/studies/:id
 *
 *   Linked-study management:
 *     GET    /api/visits/:visitId/dicom-links
 *     POST   /api/visits/:visitId/dicom-links
 *     DELETE /api/visits/:visitId/dicom-links/:linkId
 *
 *   Authenticated image proxy (browser-facing):
 *     GET    /api/dicom/instances/:id/preview.png
 *     GET    /api/dicom/instances/:id/full.dcm   (rare, audited)
 *
 *   Internal webhook (Orthanc → Klinika; secret-guarded):
 *     POST   /api/dicom/internal/orthanc-event
 *
 * Doctor / clinic-admin only on the user-facing routes — receptionists
 * 403 at the guard layer. The webhook bypasses auth (Orthanc is not a
 * user) but requires the `X-Klinika-Orthanc-Secret` header.
 */
@Controller('api')
export class DicomController {
  constructor(
    private readonly dicom: DicomService,
    private readonly orthanc: OrthancClient,
  ) {}

  // --------------------------------------------------------------------------
  // Picker — last 10 studies
  // --------------------------------------------------------------------------

  @Get('dicom/recent')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  async recent(@Ctx() ctx: RequestContext): Promise<{ studies: DicomStudyDto[] }> {
    const studies = await this.dicom.listRecent(ctx.clinicId!, ctx);
    return { studies };
  }

  @Get('dicom/studies/:id')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  async studyDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ study: DicomStudyDetailDto }> {
    const study = await this.dicom.getStudyDetail(ctx.clinicId!, id, ctx);
    return { study };
  }

  // --------------------------------------------------------------------------
  // Visit-link surface
  // --------------------------------------------------------------------------

  @Get('visits/:visitId/dicom-links')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  async listLinks(
    @Param('visitId', new ParseUUIDPipe()) visitId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ links: DicomLinkDto[] }> {
    const links = await this.dicom.listLinksForVisit(ctx.clinicId!, visitId, ctx);
    return { links };
  }

  @Post('visits/:visitId/dicom-links')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.CREATED)
  async createLink(
    @Param('visitId', new ParseUUIDPipe()) visitId: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ link: DicomLinkDto }> {
    const parsed = CreateDicomLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const link = await this.dicom.linkStudyToVisit(
      ctx.clinicId!,
      visitId,
      parsed.data.dicomStudyId,
      ctx,
    );
    return { link };
  }

  @Delete('visits/:visitId/dicom-links/:linkId')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLink(
    @Param('visitId', new ParseUUIDPipe()) visitId: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.dicom.unlinkStudyFromVisit(ctx.clinicId!, visitId, linkId, ctx);
  }

  // --------------------------------------------------------------------------
  // Image proxy — fetches from Orthanc, streams back to the browser.
  // Cache-Control: private, no-store so previews aren't held in shared
  // caches / proxies / disk caches.
  // --------------------------------------------------------------------------

  @Get('dicom/instances/:instanceId/preview.png')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  async instancePreview(
    @Param('instanceId') instanceId: string,
    @Ctx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    validateOrthancId(instanceId);
    await this.dicom.authorizeInstanceFetch(
      ctx.clinicId!,
      instanceId,
      ctx,
      'dicom.instance.viewed',
    );
    const result = await this.orthanc.fetchPreview(instanceId);
    if (!result) throw new NotFoundException('Imazhi nuk u gjet.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.buffer.byteLength));
    res.send(result.buffer);
  }

  @Get('dicom/instances/:instanceId/full.dcm')
  @UseGuards(AuthGuard, ClinicScopeGuard)
  @Roles('doctor', 'clinic_admin')
  async instanceFull(
    @Param('instanceId') instanceId: string,
    @Ctx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    validateOrthancId(instanceId);
    await this.dicom.authorizeInstanceFetch(
      ctx.clinicId!,
      instanceId,
      ctx,
      'dicom.instance.exported',
    );
    const result = await this.orthanc.fetchFullDicom(instanceId);
    if (!result) throw new NotFoundException('Imazhi nuk u gjet.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${instanceId}.dcm"`,
    );
    res.send(result.buffer);
  }

  // --------------------------------------------------------------------------
  // Internal webhook — Orthanc → Klinika on-stored event.
  // Authentication: shared secret in X-Klinika-Orthanc-Secret. We
  // bypass the AuthGuard so the call works without a user session,
  // but the secret check is strict — a missing/mismatching header
  // returns 401. The clinic is resolved by ClinicResolutionMiddleware
  // from the request host (clinic's own Caddy → its own API).
  // --------------------------------------------------------------------------

  @Post('dicom/internal/orthanc-event')
  @AllowAnonymous()
  @HttpCode(HttpStatus.NO_CONTENT)
  async orthancEvent(@Req() req: Request, @Body() body: unknown): Promise<void> {
    const expected = process.env['ORTHANC_WEBHOOK_SECRET'];
    const provided = headerValue(req.headers['x-klinika-orthanc-secret']);
    if (!expected || !provided || !timingSafeEqual(expected, provided)) {
      // Don't leak whether the header was missing vs wrong; both
      // get the same 401. The 401 (not 403) signals "auth credential
      // failed", which is what the operator expects to see in logs.
      throw new BadRequestException('Webhook authentication failed.');
    }
    const parsed = OrthancEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Webhook payload invalid.',
        issues: parsed.error.flatten(),
      });
    }

    // Clinic is resolved from the host header by the middleware. For
    // on-prem installs the API serves a single clinic, so the
    // middleware always populates clinicId. Webhooks from a
    // misconfigured Orthanc (no host route) land on the apex and
    // are dropped here.
    const reqWithCtx = req as Request & { ctx?: RequestContext };
    const clinicId = reqWithCtx.ctx?.clinicId;
    if (!clinicId) {
      // We can't index a clinic-less study. Operators see this in
      // the logs and reconfigure Orthanc's webhook URL.
      throw new BadRequestException('Webhook received without clinic context.');
    }
    await this.dicom.ingestStudyEvent(clinicId, parsed.data.studyId);
  }
}

function headerValue(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * Constant-time string comparison. Mirrors the auth module's
 * tokenHash compare so an attacker can't time webhook acceptance.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Orthanc identifiers are 8 hex groups joined by dashes — but the
 * service's authorizeInstanceFetch is the real check. We only
 * reject obviously bogus values here to short-circuit the Orthanc
 * round-trip when a probe hits the endpoint with garbage.
 */
function validateOrthancId(id: string): void {
  if (id.length === 0 || id.length > 128) {
    throw new BadRequestException('ID e instancës e pavlefshme.');
  }
  // Disallow path traversal / control bytes / quotation marks. Orthanc
  // ids in practice are `[0-9a-f-]+`; we keep the regex slightly
  // permissive to avoid surprises with future Orthanc versions.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new BadRequestException('ID e instancës e pavlefshme.');
  }
}
