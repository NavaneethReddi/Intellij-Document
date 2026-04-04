const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "openai/gpt-4o-mini";
const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function chunkText(text, chunkSize = 1200, overlap = 200) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

function magnitude(vector) {
  return Math.sqrt(dot(vector, vector));
}

function cosineSimilarity(a, b) {
  const denom = magnitude(a) * magnitude(b);
  if (!denom) {
    return 0;
  }
  return dot(a, b) / denom;
}

async function openRouterRequest(path, payload, apiKey) {
  const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${details}`);
  }

  return response.json();
}

async function createEmbeddings(inputs, apiKey) {
  const payload = {
    model: EMBEDDING_MODEL,
    input: inputs,
  };
  const response = await openRouterRequest("/embeddings", payload, apiKey);
  return response.data.map((item) => item.embedding);
}

async function createAnswer(question, context, apiKey) {
  const payload = {
    model: CHAT_MODEL,
    temperature: 0.3,
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content:
          "You answer questions about an uploaded document. Use only the provided context. " +
          "Be complete and direct. If the answer is not in the context, say that clearly.",
      },
      {
        role: "user",
        content: `Context:\n${context}\n\nQuestion:\n${question}`,
      },
    ],
  };
  const response = await openRouterRequest("/chat/completions", payload, apiKey);
  return response.choices?.[0]?.message?.content || "No answer returned.";
}

export default async (request) => {
  if (request.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders };
  }

  if (request.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json(500, { error: "Missing OPENROUTER_API_KEY" });
  }

  try {
    const { documentText, question } = JSON.parse(request.body || "{}");

    if (!documentText || !question) {
      return json(400, { error: "documentText and question are required" });
    }

    const chunks = chunkText(documentText).slice(0, 40);
    if (!chunks.length) {
      return json(400, { error: "The uploaded file did not contain readable text" });
    }

    const embeddings = await createEmbeddings([...chunks, question], apiKey);
    const questionEmbedding = embeddings[embeddings.length - 1];
    const ranked = chunks
      .map((chunk, index) => ({
        chunk,
        score: cosineSimilarity(embeddings[index], questionEmbedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const context = ranked
      .map((item, index) => `Excerpt ${index + 1}:\n${item.chunk}`)
      .join("\n\n");

    const answer = await createAnswer(question, context, apiKey);
    return json(200, { answer });
  } catch (error) {
    return json(500, { error: error.message || "Unexpected server error" });
  }
};
