import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const inputPath = process.argv[2];
const menuPath = process.argv[3];
const outPath = process.argv[4];
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

const script = `
  global.Deno = { env: { get: () => undefined } };
  import fs from "node:fs";
  const orders = JSON.parse(fs.readFileSync(${JSON.stringify(inputPath)}, "utf8"));
  const menu = JSON.parse(fs.readFileSync(${JSON.stringify(menuPath)}, "utf8"));
  import(${JSON.stringify(fabricPath)}).then((mod) => {
    const canonicalOrders = [];
    const canonicalItems = [];
    for (const raw of orders) {
      if (!raw?.id) continue;
      const adapted = mod.adaptFoodicsConsoleOrder(raw, []);
      for (const item of adapted.items) {
        const mapped = mod.mapFromMenuCatalog(item.productId, item.itemName, menu);
        item.canonicalMenuItemId = mapped.canonicalMenuItemId || null;
        item.canonicalCategory = mod.mapCanonicalFamily(mapped);
        canonicalItems.push(item);
      }
      canonicalOrders.push(adapted.order);
    }
    fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({ orders: canonicalOrders, items: canonicalItems }));
  });
`;

execFileSync(process.execPath, ["--input-type=module", "-e", script], {
  cwd: root,
  stdio: "inherit",
  maxBuffer: 32 * 1024 * 1024,
});
