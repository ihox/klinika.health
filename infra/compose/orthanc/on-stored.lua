-- Klinika ↔ Orthanc bridge: webhook on stored instance.
--
-- Orthanc calls OnStoredInstance for every received DICOM instance
-- (one ultrasound study commonly contains 5-15 instances). We POST
-- the parent study id to Klinika's bridge endpoint; the bridge
-- debounces multiple events for the same study into a single
-- dicom_studies row.
--
-- The shared-secret header is a defense-in-depth check on top of the
-- private docker network — only Klinika's API should be able to
-- receive these events, and rotating the secret breaks any leaked
-- Orthanc-side credential.
--
-- Failures are logged but never block ingestion. If the webhook is
-- down, the study still lands on disk and can be reconciled later
-- by Klinika's /api/dicom/recent endpoint (which queries Orthanc
-- directly).

function OnStoredInstance(instanceId, tags, metadata)
  -- Orthanc's OnStoredInstance `metadata` table only contains the
  -- transfer-context fields (RemoteAet, RemoteIP, CalledAet, etc.) —
  -- the parent study is not in there. Walk Instance → Study via
  -- Orthanc's in-process REST. The `/instances/<id>/study` shortcut
  -- returns the Study object directly (one hop, not two). Wired in
  -- 18b.5d; the existing receiver-side integration tests stub the
  -- payload, so this Lua path had never run against a live Orthanc.
  local study = ParseJson(RestApiGet('/instances/' .. instanceId .. '/study'))
  local studyId = study['ID']
  if studyId == nil then
    return
  end

  local webhookUrl = os.getenv('ORTHANC_WEBHOOK_URL')
  local webhookSecret = os.getenv('ORTHANC_WEBHOOK_SECRET')
  if webhookUrl == nil or webhookUrl == '' then
    return
  end

  local payload = DumpJson({
    studyId = studyId,
    instanceId = instanceId,
    timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ')
  }, true)

  local headers = {}
  headers['Content-Type'] = 'application/json'
  -- The TCP destination is api:3001 over the internal `dicom` docker
  -- network, but Klinika's ClinicResolutionMiddleware resolves the
  -- tenant from the HTTP Host header. Forcing the public hostname
  -- here lets the webhook land in the donetamed clinic's request
  -- context. Hardcoded because this Lua script ships with the
  -- donetamed compose file (per-clinic deployment; see
  -- infra/DONETAMED.md § On-stored webhook flow).
  headers['Host'] = 'donetamed.klinika.health'
  if webhookSecret ~= nil and webhookSecret ~= '' then
    headers['X-Klinika-Orthanc-Secret'] = webhookSecret
  end

  local ok, err = pcall(function()
    HttpPost(webhookUrl, payload, headers)
  end)
  if not ok then
    PrintRecursive('Klinika webhook POST failed: ' .. tostring(err))
  end
end
