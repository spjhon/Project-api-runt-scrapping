import { Router, Request, Response } from "express";
import { BrowserContext, Page } from "playwright";

// ============================================================
// RUTAS SARLAFT
// ============================================================

export default function sarlaftOFACRoutes(
  getGlobalContext: () => BrowserContext,
) {
  const router = Router();

  // ============================================================
  // RUTA: INGRESAR A OFAC
  // ============================================================

  router.post(
    "/sarlaft/ofac/init",
    async (_req: Request, res: Response): Promise<void> => {
      const { numeroDocumento, nombreCompleto } = _req.body;

      console.log("🤖 Iniciando conexión con OFAC...");

      let page: Page | null = null;

      try {
        // ========================================================
        // Obtener el contexto global
        // ========================================================

        const globalContext = getGlobalContext();

        if (!globalContext) {
          throw new Error(
            "El contexto global de Playwright no está disponible.",
          );
        }

        // ========================================================
        // Crear una nueva pestaña
        // ========================================================

        page = await globalContext.newPage();

        if (!page) {
          throw new Error("No se pudo crear la pestaña de OFAC.");
        }

        // ========================================================
        // Entrar al buscador de sanciones de OFAC
        // ========================================================

        await page.goto("https://sanctionssearch.ofac.treas.gov/", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // ========================================================
        // Esperar a que la página termine de cargar
        // ========================================================

        await page
          .waitForLoadState("networkidle", {
            timeout: 30000,
          })
          .catch(() => {
            // No necesariamente es un error.
            // Algunas páginas mantienen conexiones abiertas.

            console.log(
              "⚠️ OFAC no alcanzó networkidle. Continuamos porque la página ya cargó.",
            );
          });

        console.log("✅ OFAC cargado correctamente.");

        const nameInputSelector = "#ctl00_MainContent_txtLastName";

        await page.waitForSelector(nameInputSelector, {
          timeout: 3000,
        });

        await page.click(nameInputSelector);

        await page.fill(nameInputSelector, nombreCompleto);

        const searchButtonSelector = "#ctl00_MainContent_btnSearch";

        await page.waitForSelector(searchButtonSelector, {
          timeout: 3000,
        });

        await page.click(searchButtonSelector);

        // ========================================================
        // Esperar el resultado de la consulta
        // Puede ocurrir una de dos cosas:
        //
        // 1. OFAC no encontró resultados.
        // 2. OFAC encontró uno o más resultados.
        //
        // Esperamos ambas condiciones en paralelo.
        // ========================================================

        const noResultsSelector = "#ctl00_MainContent_pnlMessage .errormessage";

        const resultsTableSelector = "#gvSearchResults";

        const result = await Promise.race([
          page
            .waitForSelector(noResultsSelector, {
              timeout: 15000,
              state: "visible",
            })
            .then(() => "NO_RESULTS" as const),

          page
            .waitForSelector(resultsTableSelector, {
              timeout: 15000,
              state: "visible",
            })
            .then(() => "RESULTS" as const),
        ]);

        // ========================================================
        // CASO 1: NO SE ENCONTRARON RESULTADOS
        // ========================================================

        if (result === "NO_RESULTS") {
          console.log("🟢 OFAC: no se encontraron coincidencias.");

          // =====================================================
          // TOMAR SCREENSHOT EN MEMORIA
          // =====================================================

          const screenshot = await page.screenshot({
            type: "jpeg",
            quality: 85,
            fullPage: true,
          });

          const screenshotBase64 = screenshot.toString("base64");

          res.json({
            success: true,
            coincidencia: false,
            message: "No se encontraron coincidencias en OFAC.",
            resultado: null,
            screenshot: screenshotBase64,
          });

          await page.close();

          return;
        }

        // ========================================================
        // CASO 2: SE ENCONTRARON RESULTADOS
        // ========================================================

        console.log("🔴 OFAC: se encontraron coincidencias.");

        // --------------------------------------------------------
        // Obtener la primera fila de resultados
        // --------------------------------------------------------

        const firstRow = page
          .locator(`${resultsTableSelector} tbody tr`)
          .first();
        const cells = firstRow.locator("td");

        const [program, list, score] = await Promise.all([
          cells.nth(3).textContent(),
          cells.nth(4).textContent(),
          cells.nth(5).textContent(),
        ]);

        const firstResult = {
          program: program?.trim() ?? null,
          list: list?.trim() ?? null,
          score: score?.trim() ?? null,
        };

        console.log("📋 Primer resultado OFAC:", firstResult);

        // =====================================================
        // TOMAR SCREENSHOT EN MEMORIA
        // =====================================================

        const screenshot = await page.screenshot({
          type: "jpeg",
          quality: 85,
          fullPage: true,
        });

        const screenshotBase64 = screenshot.toString("base64");

        // =====================================================
        // RESPUESTA
        // =====================================================

        res.json({
          success: true,
          coincidencia: true,
          message: "Se encontraron coincidencias en OFAC.",
          resultado: firstResult,
          screenshot: screenshotBase64,
        });

        await page.close();

        return;

        //await page.close();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Error desconocido";

        console.error("❌ Error al ingresar a OFAC:", message);

        if (page) {
          await page.close().catch(() => {});
        }

        res.status(500).json({
          success: false,
          message: "No se pudo ingresar a OFAC.",
          error: message,
        });
      }
    },
  );

  return router;
}
