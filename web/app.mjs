import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";

const fileInput = document.querySelector("#file-input");
const questionInput = document.querySelector("#question-input");
const askButton = document.querySelector("#ask-button");
const statusEl = document.querySelector("#status");
const answerOutput = document.querySelector("#answer-output");
const statusBadge = document.querySelector("#status-badge");
const fileChip = document.querySelector("#file-chip");
const dropzone = document.querySelector("#dropzone");


function getChatEndpoint() {
  const { hostname, port } = window.location;
  const isLocalPythonServer = hostname === "127.0.0.1" && port === "8000";
  return isLocalPythonServer ? "/api/chat" : "/.netlify/functions/chat";
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

function setAnswerState(message, state = "empty") {
  answerOutput.textContent = message;
  answerOutput.classList.toggle("is-empty", state === "empty");
  answerOutput.classList.toggle("is-loading", state === "loading");
}

function updateFileChip(file) {
  fileChip.textContent = file ? `${file.name} selected` : "No file selected";
}

function syncFileSelection(files) {
  const [file] = files || [];
  updateFileChip(file);
}

async function parseApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const preview = text.trim().slice(0, 120);
  throw new Error(
    `Chat API returned ${response.status} ${response.statusText || ""}. ` +
      `Expected JSON but received ${contentType || "unknown content"}` +
      (preview ? `: ${preview}` : ".")
  );
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
    const text = textContent.items.map((item) => item.str).join(" ");
    pages.push(text);
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

askButton.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  const question = questionInput.value.trim();

  if (!file) {
    setStatus("Choose a PDF or DOCX file.", "error");
    return;
  }

  if (!question) {
    setStatus("Enter a question.", "error");
    return;
  }

  askButton.disabled = true;
  setAnswerState("Working", "loading");

  try {
    setStatus("Extracting text from the uploaded file...", "busy");
    const documentText = await extractText(file);

    if (!documentText.trim()) {
      throw new Error("The file did not contain readable text");
    }

    const endpoint = getChatEndpoint();
    setStatus(`Sending document context to ${endpoint}...`, "busy");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentText,
        question,
      }),
    });

    const payload = await parseApiResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    setAnswerState(payload.answer, "ready");
    setStatus("Answer generated.", "success");
  } catch (error) {
    setAnswerState("Unable to answer the question.", "empty");
    setStatus(error.message || "Unexpected error", "error");
  } finally {
    askButton.disabled = false;
  }
});

updateFileChip();
setAnswerState("No answer yet.", "empty");
