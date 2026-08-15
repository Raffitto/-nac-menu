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
  const slugById = {
    "6ddec987-ccbe-43e9-bf7d-d995bee4bf6a": "brunch",
    "2f6aa5b1-4e29-4238-9d29-bfdf00a530cb": "daytime",
    "a66f334e-f80f-45b7-af57-94b834b02038": "breakfast",
    "9b2d3b67-3d98-40ee-acd4-5fd415711278": "evening",
    "635b0543-5417-4a14-932d-8fc2d14f71b6": "desserts",
    "5b84b46c-4d01-4893-b9bf-a88cdff393b8": "drinks",
  };
  for (const row of menu) {
    row.categorySlug = row.categorySlug || slugById[row.categoryId] || slugById[row.category_id] || null;
  }
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
