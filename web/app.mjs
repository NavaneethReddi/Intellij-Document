import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";

const fileInput = document.querySelector("#file-input");
const questionInput = document.querySelector("#question-input");
const askButton = document.querySelector("#ask-button");
const statusEl = document.querySelector("#status");
const answerOutput = document.querySelector("#answer-output");

function setStatus(message) {
  statusEl.textContent = message;
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

askButton.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  const question = questionInput.value.trim();

  if (!file) {
    setStatus("Choose a PDF or DOCX file.");
    return;
  }

  if (!question) {
    setStatus("Enter a question.");
    return;
  }

  askButton.disabled = true;
  answerOutput.textContent = "Working...";

  try {
    setStatus("Extracting text from the uploaded file...");
    const documentText = await extractText(file);

    if (!documentText.trim()) {
      throw new Error("The file did not contain readable text");
    }

    setStatus("Sending document context to the Netlify function...");
    const response = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentText,
        question,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    answerOutput.textContent = payload.answer;
    setStatus("Done.");
  } catch (error) {
    answerOutput.textContent = "Unable to answer the question.";
    setStatus(error.message || "Unexpected error");
  } finally {
    askButton.disabled = false;
  }
});
