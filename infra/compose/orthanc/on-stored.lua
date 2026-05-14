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
  local studyId = metadata['ParentStudy']
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
