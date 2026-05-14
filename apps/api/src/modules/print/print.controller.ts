import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import { HistoryPrintQuerySchema } from './print.dto';
import { PrintService } from './print.service';

/**
 * Print pipeline endpoints.
 *
 *   GET /api/print/visit/:id           — visit report PDF
 *   GET /api/print/vertetim/:id        — vërtetim PDF (regenerated)
 *   GET /api/print/history/:patientId  — history PDF (optional US appendix)
 *
 * All return `application/pdf` with `Cache-Control: no-store`. The
 * frontend embeds these URLs in a hidden iframe and triggers print
 * via `iframe.contentWindow.print()` once the PDF loads.
 *
 * Doctor / clinic-admin only — receptionists 403 at the guard.
 */
@Controller('api/print')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class PrintController {
  constructor(private readonly print: PrintService) {}

  @Get('visit/:id')
  @Roles('doctor', 'clinic_admin')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'application/pdf')
  async visitReport(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.print.renderVisitReportPdf(ctx.clinicId!, id, ctx);
    sendPdf(res, pdf, `raport-vizite-${id}.pdf`);
  }

  @Get('vertetim/:id')
  @Roles('doctor', 'clinic_admin')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'application/pdf')
  async vertetim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.print.renderVertetimPdf(ctx.clinicId!, id, ctx);
    sendPdf(res, pdf, `vertetim-${id}.pdf`);
  }

  @Get('history/:patientId')
  @Roles('doctor', 'clinic_admin')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'application/pdf')
  async history(
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = HistoryPrintQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Kërkesa e pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const pdf = await this.print.renderHistoryPdf(
      ctx.clinicId!,
      patientId,
      parsed.data.include_ultrasound,
      ctx,
    );
    sendPdf(res, pdf, `historia-${patientId}.pdf`);
  }
}

function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  res.setHeader('Content-Length', String(pdf.byteLength));
  // `inline` so the browser displays the PDF inside the hidden
  // iframe for the print flow. The filename hint helps when the
  // user uses the browser's "Save as" instead of the print button.
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
  );
  res.send(pdf);
}
