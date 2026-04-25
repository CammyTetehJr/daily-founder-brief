import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

import type { ComposedBrief } from "../compose";

const COLORS = {
  bg: "#0a0a0a",
  border: "#232323",
  text: "#f5f5f5",
  accent: "#e5e5e5",
  muted: "#9a9a9a",
  dim: "#6a6a6a",
};

const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

const label: React.CSSProperties = {
  color: COLORS.dim,
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontFamily: MONO,
  margin: 0,
};

const paragraph: React.CSSProperties = {
  color: COLORS.text,
  fontSize: "14px",
  lineHeight: 1.6,
  fontFamily: MONO,
  margin: "8px 0 0 0",
};

const meta: React.CSSProperties = {
  color: COLORS.accent,
  fontSize: "12px",
  fontFamily: MONO,
  margin: 0,
};

const dim: React.CSSProperties = {
  color: COLORS.dim,
  fontSize: "11px",
  fontFamily: MONO,
  margin: 0,
};

const ruleStyle: React.CSSProperties = {
  borderTop: `1px solid ${COLORS.border}`,
  borderBottom: "none",
  borderLeft: "none",
  borderRight: "none",
  margin: "28px 0 16px",
};

export type FounderBriefProps = {
  brief: ComposedBrief;
  date: string;
};

export function FounderBriefEmail({ brief, date }: FounderBriefProps) {
  const hasSignals = brief.signal_bullets.length > 0;
  const hasActions = brief.actions.length > 0;

  return (
    <Html>
      <Head />
      <Preview>{brief.headline}</Preview>
      <Body
        style={{
          backgroundColor: COLORS.bg,
          color: COLORS.text,
          fontFamily: MONO,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0",
            padding: "36px 24px 48px",
          }}
        >
          <Text style={label}>
            {date}  //  daily founder brief
          </Text>

          <Heading
            as="h1"
            style={{
              color: COLORS.text,
              fontSize: "20px",
              fontWeight: 500,
              lineHeight: 1.35,
              fontFamily: MONO,
              margin: "14px 0 6px 0",
            }}
          >
            {brief.headline}
          </Heading>

          <Text style={{ ...dim, fontSize: "12px" }}>
            {brief.signal_bullets.length} signal
            {brief.signal_bullets.length === 1 ? "" : "s"} / threat{" "}
            {brief.threat_level}/10
          </Text>

          <Text style={{ ...paragraph, margin: "20px 0 0 0" }}>
            {brief.opening}
          </Text>

          {hasSignals && (
            <>
              <Hr style={ruleStyle} />
              <Text style={label}>signals</Text>
              {brief.signal_bullets.map((s, i) => (
                <Section key={i} style={{ margin: "16px 0 0 0" }}>
                  <Text style={meta}>
                    {s.competitor} / {s.signal_type} /{" "}
                    {Math.round(s.confidence * 100)}%
                  </Text>
                  <Text
                    style={{ ...paragraph, margin: "6px 0 4px 0" }}
                  >
                    {s.one_liner}
                  </Text>
                  <Text style={dim}>
                    receipt:{" "}
                    {s.receipt.startsWith("http") ? (
                      <Link
                        href={s.receipt}
                        style={{ color: COLORS.muted, textDecoration: "underline" }}
                      >
                        {s.receipt}
                      </Link>
                    ) : (
                      s.receipt
                    )}
                  </Text>
                </Section>
              ))}
            </>
          )}

          <Hr style={ruleStyle} />
          <Text style={label}>interpretation</Text>
          <Text style={paragraph}>{brief.what_it_means}</Text>

          {hasActions && (
            <>
              <Hr style={ruleStyle} />
              <Text style={label}>actions</Text>
              {brief.actions.map((a, i) => (
                <Text key={i} style={{ ...paragraph, margin: "10px 0 0 0" }}>
                  <span style={{ color: COLORS.dim }}>&gt;</span> {a}
                </Text>
              ))}
            </>
          )}

          <Hr style={{ ...ruleStyle, margin: "40px 0 0" }} />
          <Text style={{ ...dim, fontSize: "10px", margin: "12px 0 0" }}>
            daily founder brief / toneswap
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default FounderBriefEmail;
