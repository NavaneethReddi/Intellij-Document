import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";

const fileInput = document.querySelector("#file-input");
const questionInput = document.querySelector("#question-input");
const askButton = document.querySelector("#ask-button");
const startInterviewButton = document.querySelector("#start-interview-button");
const recordAnswerButton = document.querySelector("#record-answer-button");
const stopVoiceButton = document.querySelector("#stop-voice-button");
const statusEl = document.querySelector("#status");
const answerOutput = document.querySelector("#answer-output");
const currentQuestionEl = document.querySelector("#current-question");
const transcriptOutput = document.querySelector("#transcript-output");
const interviewHistoryEl = document.querySelector("#interview-history");
const interviewScoreEl = document.querySelector("#interview-score");
const recordingPill = document.querySelector("#recording-pill");
const voiceSupportPill = document.querySelector("#voice-support-pill");
const statusBadge = document.querySelector("#status-badge");
const fileChip = document.querySelector("#file-chip");
const dropzone = document.querySelector("#dropzone");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  documentText: "",
  documentFingerprint: "",
  interviewHistory: [],
  currentQuestion: "",
  currentTranscript: "",
  isInterviewActive: false,
  isRecording: false,
  isSubmittingAnswer: false,
  recognition: null,
  voiceSupported: Boolean(SpeechRecognition && window.speechSynthesis),
};

function getChatEndpoints() {
  return ["/api/chat"];
}

function setStatus(message, tone = "idle") {
  statusEl.textContent = message;
  statusEl.classList.remove("is-error", "is-success");
  statusBadge.classList.remove("is-busy");

  if (tone === "error") {
    statusEl.classList.add("is-error");
    statusBadge.textContent = "Needs attention";
    return;
  }

  if (tone === "success") {
    statusEl.classList.add("is-success");
    statusBadge.textContent = "Ready";
    return;
  }

  if (tone === "busy") {
    statusBadge.classList.add("is-busy");
    statusBadge.textContent = "Working";
    return;
  }

  statusBadge.textContent = "Idle";
}

function setAnswerState(message, stateName = "empty") {
  answerOutput.textContent = message;
  answerOutput.classList.toggle("is-empty", stateName === "empty");
  answerOutput.classList.toggle("is-loading", stateName === "loading");
}

function setQuestionState(message, stateName = "empty") {
  currentQuestionEl.textContent = message;
  currentQuestionEl.classList.toggle("is-empty", stateName === "empty");
  currentQuestionEl.classList.toggle("is-loading", stateName === "loading");
}

function setTranscriptState(message, stateName = "empty") {
  transcriptOutput.textContent = message;
  transcriptOutput.classList.toggle("is-empty", stateName === "empty");
  transcriptOutput.classList.toggle("is-loading", stateName === "loading");
}

function updateVoiceSupport() {
  if (state.voiceSupported) {
    voiceSupportPill.textContent = "Voice interview supported";
    voiceSupportPill.classList.remove("muted-pill");
    return;
  }

  voiceSupportPill.textContent = "Voice interview requires speech recognition support";
  voiceSupportPill.classList.add("muted-pill");
}

function updateRecordingState(label, active = false) {
  recordingPill.textContent = label;
  recordingPill.classList.toggle("active-pill", active);
  recordingPill.classList.toggle("muted-pill", !active);
}

function renderHistory() {
  if (state.interviewHistory.length === 0) {
    interviewHistoryEl.textContent = "No interview turns yet.";
    interviewHistoryEl.className = "history-list empty-history";
    interviewScoreEl.textContent = "Score pending";
    return;
  }

  interviewHistoryEl.className = "history-list";
  interviewHistoryEl.innerHTML = state.interviewHistory
    .map(
      (turn, index) => `
        <article class="history-item">
          <div class="history-item-head">
            <span class="history-turn">Turn ${index + 1}</span>
            <span class="history-score">Score ${turn.score}/10</span>
          </div>
          <p class="history-copy"><strong>Question:</strong> ${escapeHtml(turn.question)}</p>
          <p class="history-copy"><strong>Answer:</strong> ${escapeHtml(turn.answer)}</p>
          <p class="history-copy"><strong>Feedback:</strong> ${escapeHtml(turn.feedback)}</p>
        </article>
      `
    )
    .join("");

  const average =
    state.interviewHistory.reduce((total, turn) => total + (Number(turn.score) || 0), 0) /
    state.interviewHistory.length;
  interviewScoreEl.textContent = `Avg score ${average.toFixed(1)}/10`;
}

function updateFileChip(file) {
  fileChip.textContent = file ? `${file.name} selected` : "No file selected";
}

function syncFileSelection(files) {
  const [file] = files || [];
  updateFileChip(file);
  state.documentText = "";
  state.documentFingerprint = "";
  state.interviewHistory = [];
  state.currentQuestion = "";
  state.currentTranscript = "";
  state.isInterviewActive = false;
  setQuestionState("Start the interview to hear the first question.", "empty");
  setTranscriptState("Your spoken answer will appear here.", "empty");
  setAnswerState("No answer yet.", "empty");
  renderHistory();
  updateInterviewButtons();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function parseApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to the plain-text error path below.
    }
  }

  const preview = text.trim().slice(0, 120);
  throw new Error(
    `Chat API returned ${response.status} ${response.statusText || ""}. ` +
      `Expected JSON but received ${contentType || "unknown content"}` +
      (preview ? `: ${preview}` : ".")
  );
}

async function requestChat(payload) {
  const endpoints = getChatEndpoints();
  const errors = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const parsed = await parseApiResponse(response);

      if (!response.ok) {
        const message = parsed.error || `Request failed at ${endpoint}`;
        const shouldStopFallback = endpoint === "/.netlify/functions/chat";

        if (shouldStopFallback) {
          throw new Error(message);
        }

        throw new Error(message);
      }

      return parsed;
    } catch (error) {
      errors.push(`${endpoint}: ${error.message || "Request failed"}`);

      const isNetlifyEnvError =
        endpoint === "/.netlify/functions/chat" &&
        String(error.message || "").includes("Missing OPENROUTER_API_KEY");

      if (isNetlifyEnvError) {
        throw new Error(
          "Missing OPENROUTER_API_KEY. Add it to a local .env file and restart netlify dev."
        );
      }

      const isOpenRouterAuthError =
        endpoint === "/.netlify/functions/chat" &&
        String(error.message || "").includes("OpenRouter request failed (401)");

      if (isOpenRouterAuthError) {
        throw new Error(
          "OpenRouter rejected the API key with 401 User not found. Replace OPENROUTER_API_KEY in .env with a valid OpenRouter key and restart netlify dev."
        );
      }
    }
  }

  throw new Error(errors.join(" | "));
}

async function extractPdfText(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map((item) => item.str).join(" "));
  }

  return pages.join("\n");
}

async function extractDocxText(file) {
  const buffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractText(file) {
  if (!file) {
    throw new Error("Choose a file first");
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return extractPdfText(file);
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    return extractDocxText(file);
  }

  throw new Error("Only PDF and DOCX files are supported");
}

async function ensureDocumentText() {
  const file = fileInput.files?.[0];
  if (!file) {
    throw new Error("Choose a PDF or DOCX resume first.");
  }

  const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
  if (state.documentText && state.documentFingerprint === fingerprint) {
    return state.documentText;
  }

  setStatus("Extracting text from the uploaded file...", "busy");
  const documentText = await extractText(file);
  if (!documentText.trim()) {
    throw new Error("The file did not contain readable text");
  }

  state.documentText = documentText;
  state.documentFingerprint = fingerprint;
  return documentText;
}

function speakText(text) {
  if (!window.speechSynthesis || !text) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onstart = () => {
    stopVoiceButton.disabled = false;
  };
  utterance.onend = () => {
    if (!state.isRecording) {
      stopVoiceButton.disabled = true;
    }
  };
  window.speechSynthesis.speak(utterance);
}

function stopVoice() {
  if (state.recognition && state.isRecording) {
    state.recognition.stop();
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (!state.isRecording) {
    stopVoiceButton.disabled = true;
  }
}

function updateInterviewButtons() {
  const hasFile = Boolean(fileInput.files?.[0]);
  const canRecord =
    state.voiceSupported &&
    state.isInterviewActive &&
    !state.isRecording &&
    !state.isSubmittingAnswer &&
    Boolean(state.currentQuestion);

  startInterviewButton.disabled = !hasFile || state.isSubmittingAnswer;
  recordAnswerButton.disabled = !canRecord;
  stopVoiceButton.disabled = !(state.isRecording || window.speechSynthesis?.speaking);
}

async function submitInterviewAnswer(answer) {
  state.isSubmittingAnswer = true;
  updateInterviewButtons();
  setTranscriptState(answer, "ready");
  setAnswerState("Reviewing your answer...", "loading");

  try {
    const documentText = await ensureDocumentText();
    const payload = await requestChat({
      action: "interview_turn",
      documentText,
      answer,
      history: state.interviewHistory,
    });

    state.interviewHistory.push({
      question: state.currentQuestion,
      answer,
      feedback: payload.feedback || "Feedback unavailable.",
      score: Number(payload.score) || 0,
    });
    renderHistory();
    setAnswerState(
      `${payload.feedback || "Feedback unavailable."}\n\n${payload.summary || ""}`.trim(),
      "ready"
    );

    if (payload.shouldEnd) {
      state.isInterviewActive = false;
      state.currentQuestion = "";
      setQuestionState("Interview complete. Review your feedback and history.", "empty");
      setStatus("Interview finished.", "success");
      stopVoiceButton.disabled = true;
      return;
    }

    state.currentQuestion = payload.question || "Tell me more about your most relevant experience.";
    setQuestionState(state.currentQuestion, "ready");
    setStatus("Next interview question is ready.", "success");
    speakText(state.currentQuestion);
  } catch (error) {
    setAnswerState("Unable to continue the interview.", "empty");
    setStatus(error.message || "Unexpected error", "error");
  } finally {
    state.isSubmittingAnswer = false;
    updateInterviewButtons();
  }
}

function createRecognition() {
  if (!state.voiceSupported) {
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isRecording = true;
    state.currentTranscript = "";
    updateRecordingState("Listening", true);
    setTranscriptState("Listening...", "loading");
    updateInterviewButtons();
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
    }
    state.currentTranscript = transcript.trim();
    setTranscriptState(state.currentTranscript || "Listening...", state.currentTranscript ? "ready" : "loading");
  };

  recognition.onerror = (event) => {
    state.isRecording = false;
    updateRecordingState("Mic error", false);
    setStatus(`Speech recognition error: ${event.error}`, "error");
    updateInterviewButtons();
  };

  recognition.onend = async () => {
    state.isRecording = false;
    updateRecordingState("Mic idle", false);
    updateInterviewButtons();

    if (!state.currentTranscript) {
      setTranscriptState("No speech captured. Try recording again.", "empty");
      return;
    }

    await submitInterviewAnswer(state.currentTranscript);
  };

  return recognition;
}

async function handleManualQuestion() {
  const question = questionInput.value.trim();
  if (!question) {
    setStatus("Enter a manual question.", "error");
    return;
  }

  askButton.disabled = true;
  setAnswerState("Working", "loading");

  try {
    const documentText = await ensureDocumentText();
    setStatus("Sending document context to the chat API...", "busy");
    const payload = await requestChat({
      action: "qa",
      documentText,
      question,
    });
    setAnswerState(payload.answer, "ready");
    setStatus("Answer generated.", "success");
  } catch (error) {
    setAnswerState("Unable to answer the question.", "empty");
    setStatus(error.message || "Unexpected error", "error");
  } finally {
    askButton.disabled = false;
    updateInterviewButtons();
  }
}

async function startInterview() {
  if (!state.voiceSupported) {
    setStatus("This browser does not support voice interview mode.", "error");
    return;
  }

  startInterviewButton.disabled = true;
  setQuestionState("Preparing the interview...", "loading");
  setTranscriptState("Your spoken answer will appear here.", "empty");
  setAnswerState("Building your first interview prompt...", "loading");

  try {
    const documentText = await ensureDocumentText();
    setStatus("Creating a resume-based interview...", "busy");
    const payload = await requestChat({
      action: "interview_init",
      documentText,
    });

    state.interviewHistory = [];
    state.isInterviewActive = true;
    state.currentQuestion =
      payload.question || "Tell me about yourself and the strongest experience in your resume.";

    renderHistory();
    setQuestionState(state.currentQuestion, "ready");
    setAnswerState(
      [payload.intro, payload.candidateSnapshot, (payload.focusAreas || []).length
        ? `Focus areas: ${(payload.focusAreas || []).join(", ")}`
        : ""]
        .filter(Boolean)
        .join("\n\n"),
      "ready"
    );
    setStatus("Interview is ready. Listen for the question or press Record Answer.", "success");
    speakText([payload.intro, state.currentQuestion].filter(Boolean).join(" "));
  } catch (error) {
    state.isInterviewActive = false;
    setQuestionState("Unable to start the interview.", "empty");
    setAnswerState("Interview setup failed.", "empty");
    setStatus(error.message || "Unexpected error", "error");
  } finally {
    updateInterviewButtons();
  }
}

function startRecording() {
  if (!state.recognition) {
    setStatus("Voice capture is not available in this browser.", "error");
    return;
  }

  stopVoice();
  state.currentTranscript = "";
  state.recognition.start();
}

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
});

dropzone.addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files;
  if (!files?.length) {
    return;
  }

  fileInput.files = files;
  syncFileSelection(files);
});

fileInput.addEventListener("change", () => {
  syncFileSelection(fileInput.files);
});

askButton.addEventListener("click", handleManualQuestion);
startInterviewButton.addEventListener("click", startInterview);
recordAnswerButton.addEventListener("click", startRecording);
stopVoiceButton.addEventListener("click", stopVoice);

state.recognition = createRecognition();
updateVoiceSupport();
updateRecordingState("Mic idle", false);
updateFileChip();
renderHistory();
setQuestionState("Start the interview to hear the first question.", "empty");
setTranscriptState("Your spoken answer will appear here.", "empty");
setAnswerState("No answer yet.", "empty");
updateInterviewButtons();
