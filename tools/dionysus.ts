const apiBase = process.env.DIONYSUS_API_BASE ?? "http://localhost:23100";

async function main(): Promise<void> {
  const [domain, action, ...args] = process.argv.slice(2);

  if (domain === "goal" && action === "create") {
    const title = readFlag(args, "--title") ?? "Untitled goal";
    const description = readFlag(args, "--description") ?? title;
    const targetRoot = readFlag(args, "--target-root") ?? process.env.TARGET_COUPON_ROOT ?? process.cwd();
    const response = await fetch(`${apiBase}/api/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description, targetRoot })
    });
    const body = await response.text();
    console.log(body);
    if (!response.ok) process.exitCode = 1;
    return;
  }

  if (domain === "task" && action === "create") {
    const goalId = requiredFlag(args, "--goal-id");
    const title = requiredFlag(args, "--title");
    const description = readFlag(args, "--description") ?? title;
    const roleRequired = readFlag(args, "--role") ?? "worker";
    const response = await fetch(`${apiBase}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goalId, title, description, roleRequired })
    });
    const body = await response.text();
    console.log(body);
    if (!response.ok) process.exitCode = 1;
    return;
  }

  console.log(`Usage:
  pnpm goal:create -- --title "..." --description "..." --target-root "/path/to/project"
  tsx tools/dionysus.ts task create --goal-id "..." --title "..." --role worker
`);
  process.exitCode = 1;
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
