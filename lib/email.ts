import { Resend } from "resend";

let _resend: Resend | null = null;

function client() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

export async function sendBrief(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ id: string }> {
  const from = process.env.FROM_EMAIL ?? "noreply@updates.toneswap.app";
  const result = await client().emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  if (!result.data) {
    throw new Error("Resend send returned no data");
  }
  return { id: result.data.id };
}
