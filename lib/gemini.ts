import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

let _client: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  if (_client) return _client;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is not set; run `gcloud auth application-default login` and add the env vars",
    );
  }
  _client = new GoogleGenAI({ vertexai: true, project, location });
  return _client;
}

export async function analyzeScreenshot(params: {
  imageBuffer: Buffer;
  prompt: string;
}): Promise<string> {
  const response = await client().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: params.imageBuffer.toString("base64"),
            },
          },
          { text: params.prompt },
        ],
      },
    ],
  });
  return response.text ?? "";
}
