import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface CompiledDocument {
  path: string;
  kind: "markdown" | "html" | "code" | "config" | "other";
  lineCount: number;
  sizeBytes: number;
}

export interface DocumentFinding {
  documentPath: string;
  findingType: string;
  severity: "info" | "warning" | "blocked";
  lineNumber?: number;
  excerpt: string;
}

export interface BuildGraphNodeDraft {
  nodeKey: string;
  label: string;
  nodeType: string;
  status: string;
}

export interface BuildGraphEdgeDraft {
  sourceKey: string;
  targetKey: string;
  label?: string;
}

export interface DocumentCompileResult {
  documents: CompiledDocument[];
  findings: DocumentFinding[];
  nodes: BuildGraphNodeDraft[];
  edges: BuildGraphEdgeDraft[];
}

const gapPattern = /(待补充|未定义|占位|后续|P1|TODO|FIXME|TBD)/i;

export async function compileTargetProject(root: string): Promise<DocumentCompileResult> {
  const candidateFiles = await collectCandidateFiles(root);
  const documents: CompiledDocument[] = [];
  const findings: DocumentFinding[] = [];

  for (const filePath of candidateFiles) {
    const absolutePath = join(root, filePath);
    const fileStat = await stat(absolutePath);
    const text = await readFile(absolutePath, "utf8");
    const lines = text.split(/\r?\n/);
    const kind = classifyFile(filePath);
    documents.push({
      path: filePath,
      kind,
      lineCount: lines.length,
      sizeBytes: fileStat.size
    });

    lines.forEach((line, index) => {
      if (gapPattern.test(line)) {
        findings.push({
          documentPath: filePath,
          findingType: "gap_marker",
          severity: line.includes("未定义") || line.includes("待补充") ? "blocked" : "warning",
          lineNumber: index + 1,
          excerpt: line.trim().slice(0, 500)
        });
      }
    });
  }

  const nodes = buildDefaultProductNodes();
  const edges = buildDefaultProductEdges();

  return { documents, findings, nodes, edges };
}

async function collectCandidateFiles(root: string): Promise<string[]> {
  const includeRoots = ["AGENTS.md", "docs", "apps/admin-web/html", "apps/admin-web"];
  const files: string[] = [];

  for (const includeRoot of includeRoots) {
    const absolute = join(root, includeRoot);
    try {
      const fileStat = await stat(absolute);
      if (fileStat.isFile() && shouldInclude(absolute)) {
        files.push(relative(root, absolute));
      }
      if (fileStat.isDirectory()) {
        files.push(...(await walk(root, absolute)));
      }
    } catch {
      // Missing optional roots are findings in later rule phases, not scanner crashes.
    }
  }

  return Array.from(new Set(files)).sort();
}

async function walk(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      files.push(...(await walk(root, absolute)));
    } else if (entry.isFile() && shouldInclude(absolute)) {
      files.push(relative(root, absolute));
    }
  }
  return files;
}

function shouldInclude(path: string): boolean {
  return [".md", ".html", ".vue", ".yaml", ".yml", ".json"].includes(extname(path));
}

function classifyFile(path: string): CompiledDocument["kind"] {
  const ext = extname(path);
  if (ext === ".md") return "markdown";
  if (ext === ".html") return "html";
  if (ext === ".vue") return "code";
  if ([".yaml", ".yml", ".json"].includes(ext)) return "config";
  return "other";
}

function buildDefaultProductNodes(): BuildGraphNodeDraft[] {
  return [
    ["identity", "身份与租户", "domain"],
    ["tenant", "租户管理", "domain"],
    ["catalog", "产品主数据", "domain"],
    ["inventory", "库存", "domain"],
    ["voucher", "券实例", "domain"],
    ["card", "卡实例", "domain"],
    ["approval", "审批", "domain"],
    ["finance", "财务", "domain"],
    ["reporting", "报表", "domain"],
    ["client", "C 端 H5", "domain"],
    ["device", "设备接入", "domain"]
  ].map(([nodeKey, label, nodeType]) => ({ nodeKey, label, nodeType, status: "planned" }));
}

function buildDefaultProductEdges(): BuildGraphEdgeDraft[] {
  return [
    ["identity", "tenant"],
    ["tenant", "catalog"],
    ["catalog", "inventory"],
    ["inventory", "voucher"],
    ["inventory", "card"],
    ["voucher", "approval"],
    ["card", "approval"],
    ["approval", "finance"],
    ["finance", "reporting"],
    ["voucher", "client"],
    ["voucher", "device"]
  ].map(([sourceKey, targetKey]) => ({ sourceKey, targetKey }));
}
