import { Router, Request, Response } from "express";
import { BrowserContext, Page } from "playwright";

// ============================================================
// RUTAS SARLAFT - NACIONES UNIDAS
// ============================================================

export default function sarlaftUNRoutes(
  getGlobalContext: () => BrowserContext,
) {
  const router = Router();

  // ============================================================
  // RUTA: INGRESAR A NACIONES UNIDAS
  // ============================================================

  router.post(
    "/sarlaft/un/init",
    async (_req: Request, res: Response): Promise<void> => {
      const { numeroDocumento, nombreCompleto } = _req.body;

      console.log("🤖 Iniciando conexión con Naciones Unidas...");

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
          throw new Error("No se pudo crear la pestaña de Naciones Unidas.");
        }

        // ========================================================
        // Entrar al buscador de sanciones de Naciones Unidas
        // ========================================================

        await page.goto("https://search.sanctions.un.org/", {
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
            console.log(
              "⚠️ Naciones Unidas no alcanzó networkidle. " +
                "Continuamos porque la página ya cargó.",
            );
          });

        console.log("✅ Buscador de Naciones Unidas cargado correctamente.");

        // ========================================================
        // Input de búsqueda
        // ========================================================

        const searchInputSelector =
          "#root > div > div > form > div.search-inputs-container > " +
          "div.search-inputfield-container > div > div > input";

        await page.waitForSelector(searchInputSelector, {
          timeout: 5000,
        });

        await page.fill(searchInputSelector, numeroDocumento);

        console.log("✅ Nombre ingresado en el buscador de Naciones Unidas.");

        // ========================================================
        // Botón de búsqueda
        // ========================================================

        const searchButtonSelector =
          "#root > div > div > form > div.search-inputs-container > " +
          "div.search-btns > button";

        await page.waitForSelector(searchButtonSelector, {
          timeout: 5000,
        });

        await page.click(searchButtonSelector);

        console.log("🔎 Búsqueda enviada a Naciones Unidas.");

        const totalCountSelector =
          "#root > div > div.pagination-container > div > div.total-results > span";

        await page.waitForSelector(totalCountSelector, {
          timeout: 5000,
        });

        const totalCountText = await page
          .locator(totalCountSelector)
          .textContent();

        const totalCount = Number(
          totalCountText?.replace("Total:", "").trim() ?? "0",
        );

        console.log("📊 Total de resultados ONU:", totalCount);

        if (totalCount > 0) {
          console.log("🔴 Naciones Unidas: se encontraron coincidencias.");

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
            message:
              "Se encontraron coincidencias en la lista de sancionados de las Naciones Unidas.",
            resultado: "Se encontraron coincidencias",
            screenshot: screenshotBase64,
          });

           await page.close();
          return;
        } else if (totalCount == 0) {
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

          // =====================================================
          // RESPUESTA
          // =====================================================

          res.json({
            success: true,
            coincidencia: false,
            message:
              "NO se encontraron coincidencias en la lista de sancionados de las Naciones Unidas.",
            resultado: "NO se encontraron coincidencias",
            screenshot: screenshotBase64,
          });

           await page.close();
          return;
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Error desconocido";

        console.error("❌ Error al ingresar a Naciones Unidas:", message);

        if (page) {
          await page.close().catch(() => {});
        }

        res.status(500).json({
          success: false,
          message: "No se pudo realizar la búsqueda en Naciones Unidas.",
          error: message,
        });
      }
    },
  );

  return router;
}
