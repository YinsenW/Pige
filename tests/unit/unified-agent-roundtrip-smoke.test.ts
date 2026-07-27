import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("apps/desktop/scripts/electron-unified-agent-roundtrip-smoke.mjs"),
  "utf8"
);

describe("unified Agent assembled smoke navigation", () => {
  it("uses the current Settings-owned progressive Models flow", () => {
    expect(source).not.toContain('clickNav("Models")');
    expect(source).not.toContain("details.custom-provider");
    expect(source).toContain('openSettingsSection("Models")');
    expect(source).toContain('.settings-inline-actions button.settings-button.primary:not(:disabled)');
    expect(source).toContain('.model-provider-picker button.model-provider-choice');
    expect(source).toContain("!reviewedPresetNames.has(choiceName)");
    expect(source).toContain('document.querySelector("button.sidebar-toggle-button")');
    expect(source).toContain('document.querySelector("button.settings-return")');
    expect(source).toContain('.model-settings-footer-actions button.primary:not(:disabled)');
    expect(source).toContain('.settings-row > button.settings-button:not(:disabled)');
    expect(source).toContain('document.querySelector(".provider-model-group")');
  });

  it("accepts secret-field removal only after the durable provider binding is ready", () => {
    const readyBinding = source.indexOf('}, "ready provider binding");');
    const clearedSecret = source.indexOf("const secretFieldCleared = await waitFor(");

    expect(readyBinding).toBeGreaterThan(-1);
    expect(clearedSecret).toBeGreaterThan(readyBinding);
    expect(source).toContain('document.querySelector("#provider-key")?.value === ""');
  });

  it("provides an isolated canonical high-risk denial route with zero command execution", () => {
    expect(source).toContain('process.argv.includes("--high-risk-only")');
    expect(source).toContain("runHighRiskDenyRenderer(browserWindow)");
    expect(source).toContain('document.querySelector(\'.confirmation-dialog[role="dialog"][aria-modal="true"]\')');
    expect(source).toContain("document.activeElement === denyButton");
    expect(source).toContain('document.querySelector(".permission-prompt, .model-egress-prompt")');
    expect(source).toContain("denied-command-must-not-exist.txt");
    expect(source).toContain('request.body.includes("function_call_output")');
  });

  it("proves unified durable conversation, citation navigation, and source results", () => {
    expect(source).not.toContain('writeToolCallResponse(response, "pige_finish_home_turn"');
    expect(source).not.toContain('writeStreamingToolCallResponse(');
    expect(source).not.toContain("terminal-answer");
    expect(source).toContain("writeTextResponse(response, GROUNDED_ANSWER");
    expect(source).toContain("writeTextResponse(response, DATASET_ANSWER");
    expect(source).toContain('document.querySelectorAll(".conversation-message.role-assistant:not(.provisional)")');
    expect(source).toContain('document.querySelector(".retrieval-citations button:not(:disabled)")');
    expect(source).toContain('await waitFor(() => document.querySelector(".note-reader"), "citation Reader")');
    expect(source).toContain('document.querySelector(".home-reader .back-button")');
    expect(source).toContain("directStillVisibleAfterGrounded");
    expect(source).toContain("groundedRetrievalVisible");
    expect(source).toContain("noProvisionalAnswerDuplicates");
    expect(source).toContain('textContent?.includes("Activity History")');
    expect(source).toContain('section.settings-page.settings-history-page[aria-labelledby="settings-history-title"]');
    expect(source).toContain('\'"call_id":"call_dataset_materialize"\'');
  });

  it("stages picker files without side effects and submits them through the real composer", () => {
    const stageHelper = source.indexOf("async function stageAndSubmitSourceRenderer");
    const stageHelperEnd = source.indexOf("async function readSourceSubmissionState", stageHelper);
    const stageHelperSource = source.slice(stageHelper, stageHelperEnd);
    const fileInjection = source.indexOf("await setRendererFileInput(browserWindow, attachmentPath);", stageHelper);
    const durableCheck = source.indexOf("Picker staging created a durable Agent side effect before Send.", fileInjection);
    const sendClick = source.indexOf("send.click();", fileInjection);

    expect(stageHelper).toBeGreaterThan(-1);
    expect(fileInjection).toBeGreaterThan(stageHelper);
    expect(source.slice(stageHelper, durableCheck)).toContain("const deadline = Date.now() + 45000;");
    expect(source.slice(stageHelper, durableCheck)).toContain("chips[0] === stagedChip");
    expect(source.slice(stageHelper, durableCheck)).toContain("currentJobs.activeVaultId === expected.activeVaultId");
    expect(source.slice(stageHelper, durableCheck)).toContain("currentTimeline?.conversationId === expected.conversationId");
    expect(source.slice(stageHelper, durableCheck)).toContain("currentTimeline?.tailEventId === expected.conversationTailEventId");
    expect(source.slice(stageHelper, durableCheck)).toContain("tail?.role === 'assistant'");
    expect(source.slice(stageHelper, durableCheck)).toContain("send && !send.disabled");
    expect(durableCheck).toBeGreaterThan(fileInjection);
    expect(sendClick).toBeGreaterThan(durableCheck);
    expect(stageHelperSource.match(/send\.click\(\)/g)).toHaveLength(1);
    expect(source.slice(stageHelper, durableCheck)).not.toContain("setTimeout(resolve, 250)");
    expect(source).toContain("sourceSelectionsHadZeroDurableSideEffects: true");
    expect(source).toContain("timelineAnswerVisible");
    expect(source).toContain("domAnswerVisible: Boolean(answer)");
    expect(source).toContain("requests.every((request) =>");
    expect(source).toContain('request.path !== "/v1/responses"');
    expect(source).not.toContain("await setRendererFileInput(browserWindow, attachmentPath);\n      result =");
  });

  it("restarts the same durable Agent fixture before cleanup without another Provider call", () => {
    const connect = source.indexOf('await runChild("connect"');
    const requestFence = source.indexOf("const requestCountBeforeRestart = requests.length;", connect);
    const restart = source.indexOf('await runChild("restart"', requestFence);
    const identityCheck = source.indexOf("assert.deepEqual(restart.durableSnapshot, connect.durableSnapshot);", restart);
    const providerCheck = source.indexOf("assert.equal(requests.length, requestCountBeforeRestart);", identityCheck);
    const cleanup = source.indexOf("fs.rmSync(rootPath, { recursive: true, force: true });", providerCheck);

    expect(connect).toBeGreaterThan(-1);
    expect(requestFence).toBeGreaterThan(connect);
    expect(restart).toBeGreaterThan(requestFence);
    expect(identityCheck).toBeGreaterThan(restart);
    expect(providerCheck).toBeGreaterThan(identityCheck);
    expect(cleanup).toBeGreaterThan(providerCheck);
    expect(source).toContain('phase !== "large_paste"');
    expect(source).toContain('phase !== "large_paste_restart"');
    expect(source).toContain('phase !== "drop"');
    expect(source).toContain('phase !== "drop_restart"');
    expect(source).toContain('throw new Error("Unknown unified Agent roundtrip phase.");');
    expect(source).toContain('job.class === "agent_turn" || job.class === "dataset_import"');
    expect(source).toContain("messageIdentities");
    expect(source).toContain("pageIdentities");
    expect(source).toContain("sourceIds");
    expect(source).toContain("datasetIds");
    expect(source).toContain("activities");
    expect(source).toContain("nonterminalJobIds");
    expect(source).toContain("failedRetryableJobIds");
    expect(source).toContain("assertUniqueIdentities(connect.durableSnapshot.messageIdentities");
    expect(source).toContain('filter((job) => job.class === "agent_turn").length, 7');
    expect(source).toContain("PIGE_ROUNDTRIP_STATE");
  });

  it("stages one real clipboard paste, submits it atomically, and restarts without replay", () => {
    const pickerRestart = source.indexOf('await runChild("restart"');
    const paste = source.indexOf('await runChild("large_paste"', pickerRestart);
    const pasteRestart = source.indexOf('await runChild("large_paste_restart"', paste);
    const drop = source.indexOf('await runChild("drop"', pasteRestart);
    const staging = source.indexOf("async function readLargePasteStagingRenderer");
    const submit = source.indexOf("async function submitLargePasteRenderer", staging);
    const stagingSource = source.slice(staging, submit);

    expect(paste).toBeGreaterThan(pickerRestart);
    expect(pasteRestart).toBeGreaterThan(paste);
    expect(drop).toBeGreaterThan(pasteRestart);
    expect(source).toContain("clipboard.writeText(LARGE_PASTE_BODY)");
    expect(source).toContain("[citation_11]");
    expect(source).toContain("item.refId === 'citation_11'");
    expect(source).toContain("citation?.pageId === expected.sourceCitationPageId");
    expect(source).toContain("citation.pageId === groundedCitation.pageId");
    expect(source).toContain(".conversation-citations .citation-row:not(:disabled)");
    expect(source).toContain('readRoundtripRecord(vaultPath, "source-records", largePaste.largePasteSourceId)');
    expect(source.indexOf("const stagedAt = Date.now()")).toBeLessThan(source.indexOf("browserWindow.webContents.paste()"));
    expect(source).toContain("browserWindow.webContents.paste()");
    expect(source).toContain("clipboard.writeText(previousClipboardText)");
    expect(source).not.toContain("new ClipboardEvent");
    expect(source).not.toContain("HomeLargePasteAdapter");
    expect(stagingSource).toContain("draftPreservedWhileStaged");
    expect(stagingSource).toContain("oneRemovablePasteChip");
    expect(stagingSource).toContain("safeMetadataExact");
    expect(stagingSource).toContain("rawBodyHidden");
    expect(stagingSource).toContain("preSendJobsUnchanged");
    expect(stagingSource).toContain("preSendConversationUnchanged");
    expect(stagingSource).not.toContain("send.click()");
    expect(source).toContain("Large-paste staging created a SourceRecord before Send.");
    expect(source.slice(submit, source.indexOf("async function runLargePasteRestartRenderer", submit)).match(/send\.click\(\)/g)).toHaveLength(1);
    expect(source).toContain("assert.equal(largePasteProviderRequests.length, 3)");
    expect(source).toContain('request.receivedAt < largePaste.stagedAt || request.receivedAt >= largePaste.submittedAt');
    expect(source).toContain("assert.equal(pastedSource.kind, \"text\")");
    expect(source).toContain("assert.equal(fs.readFileSync(pastedManagedPath, \"utf8\"), LARGE_PASTE_BODY)");
    expect(source).toContain("findPlaintextFiles(vaultPath, LARGE_PASTE_BODY)");
    expect(source).toContain("assert.equal(JSON.stringify(pastedEvents).includes(LARGE_PASTE_BODY), false)");
    expect(source).toContain("assert.equal(pastedUserEvent?.parentEventId, largePaste.baselineTailEventId)");
    expect(source).toContain("assert.deepEqual(largePasteRestart.durableSnapshot, largePaste.durableSnapshot)");
    expect(source).toContain("assert.equal(requests.length, requestCountBeforeLargePasteRestart)");
  });

  it("drives one identity-free whole-window drop through the real renderer event path and restart", () => {
    const pickerRestart = source.indexOf('await runChild("restart"');
    const drop = source.indexOf('await runChild("drop"', pickerRestart);
    const dropRestart = source.indexOf('await runChild("drop_restart"', drop);
    const cleanup = source.indexOf("fs.rmSync(rootPath, { recursive: true, force: true });", dropRestart);
    const dispatcher = source.indexOf("async function dispatchWholeWindowFileDrop");
    const dispatcherEnd = source.indexOf("async function readWholeWindowDropRendererResult", dispatcher);
    const dispatcherSource = source.slice(dispatcher, dispatcherEnd);

    expect(drop).toBeGreaterThan(pickerRestart);
    expect(dropRestart).toBeGreaterThan(drop);
    expect(cleanup).toBeGreaterThan(dropRestart);
    expect(dispatcherSource).toContain('document.querySelector(\'.app-window\')');
    expect(dispatcherSource).toContain('"Input.dispatchDragEvent"');
    expect(dispatcherSource).toContain('type: "dragEnter"');
    expect(dispatcherSource).toContain('type: "dragOver"');
    expect(dispatcherSource).toContain('type: "drop"');
    expect(dispatcherSource).toContain("files: [attachmentPath]");
    expect(dispatcherSource).not.toContain("setRendererFileInput");
    expect(source).toContain("draftPreserved");
    expect(source).toContain("draftExcludedFromTurn");
    expect(source).toContain("noStagedChips");
    expect(source).toContain("identityFreeConversation");
    expect(source).toContain("assert.equal(drop.agentTurnDelta, 1)");
    expect(source).toContain("assert.equal(drop.sourceDelta, 1)");
    expect(source).toContain("largePasteRestart.durableSnapshot.relevantJobs.length + 1");
    expect(source).toContain("largePasteRestart.durableSnapshot.sourceIds.length + 1");
    expect(source).toContain("assert.equal(drop.durableSnapshot.datasetIds.length, 0)");
    expect(source).toContain("assert.deepEqual(drop.durableSnapshot.activities, largePasteRestart.durableSnapshot.activities)");
    expect(source).toContain('assertUniqueIdentities(drop.durableSnapshot.relevantJobs.map((job) => job.id), "Job after drop")');
    expect(source).toContain("assert.equal(dropProviderRequests.length, 2)");
    expect(source).toContain("assert.deepEqual(dropRestart.durableSnapshot, drop.durableSnapshot)");
    expect(source).toContain("assert.equal(requests.length, requestCountBeforeDropRestart)");
  });

  it("pastes one URL through the real composer, cites its stable page, and restarts without refetch", () => {
    const url = source.indexOf('await runChild("url"');
    const restart = source.indexOf('await runChild("url_restart"', url);
    expect(url).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(url);
    expect(source).toContain("installSyntheticUrlTransport()");
    expect(source).toContain('hostname !== "example.com"');
    expect(source).toContain('"93.184.216.34"');
    expect(source).toContain("clipboard.writeText(URL_PROMPT)");
    expect(source).toContain("browserWindow.webContents.paste()");
    expect(source).toContain("document.querySelectorAll('.attachment-chip').length !== 0");
    expect(source).toContain("[citation_17]");
    expect(source).toContain("item.refId === 'citation_17'");
    expect(source).toContain(".conversation-citations .citation-row:not(:disabled)");
    expect(source).toContain("assert.equal(url.urlTransportCalls, 1)");
    expect(source).toContain("dropRestart.durableSnapshot.sourceIds.length + 1");
    expect(source).toContain("assert.deepEqual(urlRestart.durableSnapshot, url.durableSnapshot)");
    expect(source).toContain("assert.equal(requests.length, requestCountBeforeUrlRestart)");
  });

  it("stages one native-text PDF, parses and cites it, then restarts without replay", () => {
    const urlRestart = source.indexOf('await runChild("url_restart"');
    const pdf = source.indexOf('await runChild("pdf"', urlRestart);
    const pdfRestart = source.indexOf('await runChild("pdf_restart"', pdf);
    const cleanup = source.indexOf("fs.rmSync(rootPath, { recursive: true, force: true });", pdfRestart);
    const pdfPhase = source.indexOf('phase === "pdf"');
    const genericPicker = source.indexOf(
      "await stageAndSubmitSourceRenderer(browserWindow, pdfAttachmentPath",
      pdfPhase
    );

    expect(pdf).toBeGreaterThan(urlRestart);
    expect(pdfRestart).toBeGreaterThan(pdf);
    expect(cleanup).toBeGreaterThan(pdfRestart);
    expect(source).toContain('const PDF_ATTACHMENT_NAME = "native-text-roundtrip.pdf"');
    expect(source).toContain("createRoundtripPdf([PDF_NATIVE_TEXT]");
    expect(genericPicker).toBeGreaterThan(pdfPhase);
    expect(source).toContain("sourceRecordCountBeforePdf");
    expect(source).toContain("pdf.sourceRecordCountBeforePdf + 1");
    expect(source).toContain('writeToolCallResponse(response, "pige_inspect_source", "call_pdf_inspect_before"');
    expect(source).toContain('writeToolCallResponse(response, "pige_parse_source", "call_pdf_parse"');
    expect(source).toContain('writeToolCallResponse(response, "pige_inspect_source", "call_pdf_inspect_after"');
    expect(source).toContain('writeTextResponse(response, PDF_ANSWER, "pdf-final-1")');
    expect(source).toContain("assert.equal(pdfProviderRequests.length, 4)");
    expect(source).toContain("request.receivedAt < pdf.stagedAt || request.receivedAt >= pdf.submittedAt");
    expect(source).toContain("item.refId === 'citation_11'");
    expect(source).toContain("sourcePage?.pageId === citation.pageId");
    expect(source).toContain(".conversation-citations .citation-row:not(:disabled)");
    expect(source).toContain("if (!button) {\n            await new Promise((resolve) => setTimeout(resolve, 50));\n            continue;");
    expect(source).not.toContain("if (!button) throw new Error('PDF citation navigation action is unavailable.');");
    expect(source).toContain("assert.equal(pdfSource.knowledgePageId, pdf.pdfCitationPageId)");
    expect(source).toContain('assert.equal(pdfSource.kind, "pdf_file")');
    expect(source).toContain('job.class === "parse" && job.parentJobId === pdf.pdfJobId');
    expect(source).toContain('assert.deepEqual(pdfSource.artifacts.map((artifact) => artifact.kind), ["extracted_text", "metadata"])');
    expect(source).toContain('assert.equal(pdfMetadata.pages?.[0]?.locator, "page:1")');
    expect(source).toContain("assert.equal(artifact.checksum, sha256BufferDigest(artifactBytes))");
    expect(source).toContain("assert.deepEqual(pdfRestart.durableSnapshot, pdf.durableSnapshot)");
    expect(source).toContain("assert.equal(requests.length, requestCountBeforePdfRestart)");
  });

  it("stages two ordered TXT files, compares both, opens both citations, and restarts without replay", () => {
    const pdfRestart = source.indexOf('await runChild("pdf_restart"');
    const multiFile = source.indexOf('await runChild("multi_file"', pdfRestart);
    const multiFileRestart = source.indexOf('await runChild("multi_file_restart"', multiFile);
    const cleanup = source.indexOf("fs.rmSync(rootPath, { recursive: true, force: true });", multiFileRestart);
    const staging = source.indexOf("async function stageAndSubmitMultipleSourcesRenderer");
    const stagingEnd = source.indexOf("async function stageAndSubmitSourceRenderer", staging);
    const stagingSource = source.slice(staging, stagingEnd);

    expect(multiFile).toBeGreaterThan(pdfRestart);
    expect(multiFileRestart).toBeGreaterThan(multiFile);
    expect(cleanup).toBeGreaterThan(multiFileRestart);
    expect(source).toContain('const MULTI_FILE_FIRST_NAME = "multi-file-amber.txt"');
    expect(source).toContain('const MULTI_FILE_SECOND_NAME = "multi-file-cobalt.txt"');
    expect(source).toContain("await setRendererFileInputFiles(browserWindow, attachmentPaths)");
    expect(stagingSource).toContain("names.every((name, index) => name === expectedNames[index])");
    expect(stagingSource).toContain("chips.every((chip, index) => chip === stagedChips[index])");
    expect(stagingSource).toContain("Multi-file staging created a durable Agent side effect before Send.");
    expect(stagingSource.match(/send\.click\(\)/g)).toHaveLength(1);
    expect(source).toContain('writeToolCallResponse(response, "pige_list_attachments", "call_multi_list"');
    expect(source).toContain('attachmentRef: "attachment_1"');
    expect(source).toContain('writeToolCallResponse(response, "pige_inspect_source", "call_multi_inspect_1"');
    expect(source).toContain('attachmentRef: "attachment_2"');
    expect(source).toContain('writeToolCallResponse(response, "pige_inspect_source", "call_multi_inspect_2"');
    expect(source).toContain('writeTextResponse(response, MULTI_FILE_ANSWER, "multi-file-final-1")');
    expect(source).toContain("item.refId === 'citation_11'");
    expect(source).toContain("item.refId === 'citation_12'");
    expect(source).toContain("firstCitation.pageId !== secondCitation.pageId");
    expect(source).toContain("firstPage?.pageId === firstCitation.pageId");
    expect(source).toContain("secondPage?.pageId === secondCitation.pageId");
    expect(source).toContain("await openCitation('[11]', firstPage.title)");
    expect(source).toContain("await openCitation('[12]', secondPage.title)");
    expect(source).toContain("assert.equal(multiFile.agentTurnDelta, 1)");
    expect(source).toContain("assert.equal(multiFile.sourceDelta, 2)");
    expect(source).toContain("assert.equal(multiFileProviderRequests.length, 6)");
    expect(source).toContain("assert.deepEqual(multiFileRestart.durableSnapshot, multiFile.durableSnapshot)");
    expect(source).toContain("assert.equal(requests.length, requestCountBeforeMultiFileRestart)");
    expect(source).toContain("publishedCitationRefs: citationRefs");
    expect(source).toContain("authoredCitation12");
    expect(source).toContain("PIGE_ROUNDTRIP_MAIN_STATE");
    expect(source).toContain("knowledgePageBindingCount");
    expect(source).toContain('phase !== "multi_file"');
    expect(source).toContain('phase !== "multi_file_restart"');
  });
});
