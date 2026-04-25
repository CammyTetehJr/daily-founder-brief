import { randomUUID } from "node:crypto";
import { getDb } from "../lib/db";

const USER_EMAIL = process.env.SEED_USER_EMAIL ?? "founder@example.com";

const COMPETITORS = [
  {
    name: "Grammarly",
    website: "https://www.grammarly.com",
    pricing_page: "https://www.grammarly.com/plans",
    careers_page: "https://www.grammarly.com/jobs",
  },
  {
    name: "QuillBot",
    website: "https://quillbot.com",
    pricing_page: "https://quillbot.com/premium",
    careers_page: "https://quillbot.com/careers",
  },
  {
    name: "Wordtune",
    website: "https://www.wordtune.com",
    pricing_page: "https://www.wordtune.com/plans",
    careers_page: "https://www.ai21.com/careers",
  },
  {
    name: "ProWritingAid",
    website: "https://prowritingaid.com",
    pricing_page: "https://prowritingaid.com/Price",
    careers_page: "https://prowritingaid.com/careers",
  },
  {
    name: "LanguageTool",
    website: "https://languagetool.org",
    pricing_page: "https://languagetool.org/premium",
    careers_page: "https://languagetool.org/careers",
  },
  {
    name: "Jasper",
    website: "https://www.jasper.ai",
    pricing_page: "https://www.jasper.ai/pricing",
    careers_page: "https://www.jasper.ai/careers",
  },
];

function seed() {
  const db = getDb();

  const existingUser = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(USER_EMAIL) as { id: string } | undefined;

  const userId = existingUser?.id ?? randomUUID();
  if (!existingUser) {
    db.prepare(
      "INSERT INTO users (id, email, email_time, timezone) VALUES (?, ?, ?, ?)",
    ).run(userId, USER_EMAIL, "07:00", "Europe/Berlin");
    console.log(`+ user ${USER_EMAIL}`);
  } else {
    console.log(`= user ${USER_EMAIL} exists`);
  }

  const insertCompetitor = db.prepare(
    `INSERT OR IGNORE INTO competitors
       (id, user_id, name, website, pricing_page, careers_page)
       VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const c of COMPETITORS) {
    const result = insertCompetitor.run(
      randomUUID(),
      userId,
      c.name,
      c.website,
      c.pricing_page,
      c.careers_page,
    );
    console.log(result.changes ? `+ ${c.name}` : `= ${c.name} exists`);
  }

  console.log(`\nSeed complete. User: ${userId}`);
}

seed();
