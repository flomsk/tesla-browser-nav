import { parseCategoryQuery } from "@/lib/places";

let failed = 0;
function check(query: string, expected: { category: string; teslaOnly: boolean; place: string | null } | null) {
  const got = parseCategoryQuery(query);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} "${query}" -> ${JSON.stringify(got)}`);
}

check("supercharger", { category: "charging", teslaOnly: true, place: null });
check("supercharger madrid", { category: "charging", teslaOnly: true, place: "madrid" });
check("Supercharger in Madrid", { category: "charging", teslaOnly: true, place: "madrid" });
check("madrid supercharger", { category: "charging", teslaOnly: true, place: "madrid" });
check("cargadores cerca de alicante", { category: "charging", teslaOnly: false, place: "alicante" });
check("gasolinera valencia", { category: "fuel", teslaOnly: false, place: "valencia" });
check("gas station near Murcia", { category: "fuel", teslaOnly: false, place: "murcia" });
check("суперчарджер москва", { category: "charging", teslaOnly: true, place: "москва" });
check("кафе около аточа", { category: "cafe", teslaOnly: false, place: "аточа" });
check("calle carga", null);
check("tesla madrid", { category: "charging", teslaOnly: true, place: "madrid" });
check("gas station", { category: "fuel", teslaOnly: false, place: null });
check("gas valencia", null);
check("tesla in madrid", { category: "charging", teslaOnly: true, place: "madrid" });
check("estación de atocha", null);

if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
