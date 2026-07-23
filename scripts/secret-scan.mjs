import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const textExtensions = new Set(["", ".ts", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".html", ".css", ".example", ".xml", ".txt"]);
const findings = [];

const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).split("\0").filter(Boolean);

for (const path of candidates) {
  if (!textExtensions.has(extname(path))) continue;
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const privateKeyAssignment = /(?:PRIVATE_KEY|CLIENT_KEY)\s*=\s*([^\s#]+)/i.exec(line);
    if (privateKeyAssignment && !/^(?:$|\.\.\.|0\.0\.|your|changeme|xxxx|yyyy)/i.test(privateKeyAssignment[1])) {
      findings.push(`${path}:${index + 1}: non-empty private-key assignment`);
    }
    if (/\b(?:302e020100300506032b657004220420|3030020100300706052b8104000a04220420)[0-9a-f]{64,}\b/i.test(line)) {
      findings.push(`${path}:${index + 1}: encoded Hedera private key`);
    }
    if (/\b0x[0-9a-f]{64}\b/i.test(line) && !line.includes("TEST_VECTOR_OK")) {
      findings.push(`${path}:${index + 1}: 32-byte hex secret candidate`);
    }
  });
}

if (findings.length > 0) {
  console.error("SECRET_SCAN_FAILED");
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log(`SECRET_SCAN_OK files=${candidates.length}`);
