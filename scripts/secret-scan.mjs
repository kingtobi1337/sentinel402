import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const skipped = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set(["", ".ts", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".html", ".css", ".example"]);
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const text = await readFile(absolute, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const privateKeyAssignment = /(?:PRIVATE_KEY|CLIENT_KEY)\s*=\s*([^\s#]+)/i.exec(line);
      if (privateKeyAssignment && !/^(?:$|0\.0\.|your|changeme|xxxx|yyyy)/i.test(privateKeyAssignment[1])) {
        findings.push(`${relative(root, absolute)}:${index + 1}: non-empty private-key assignment`);
      }
      if (/\b(?:302e020100300506032b657004220420|3030020100300706052b8104000a04220420)[0-9a-f]{64,}\b/i.test(line)) {
        findings.push(`${relative(root, absolute)}:${index + 1}: encoded Hedera private key`);
      }
      if (/\b0x[0-9a-f]{64}\b/i.test(line) && !line.includes("TEST_VECTOR_OK")) {
        findings.push(`${relative(root, absolute)}:${index + 1}: 32-byte hex secret candidate`);
      }
    });
  }
}

await walk(root);
if (findings.length > 0) {
  console.error("SECRET_SCAN_FAILED");
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log("SECRET_SCAN_OK");
