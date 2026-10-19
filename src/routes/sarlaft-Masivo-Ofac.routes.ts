import { Router, Request, Response } from "express";
import { BrowserContext, Page } from "playwright";

// ============================================================
// TIPO DE CADA REGISTRO RECIBIDO
// ============================================================

type SarlaftMasivoItem = {
  fecha: string;
  placa: string;
  nombreCompleto: string;
  numeroDocumento: string;
};

// ============================================================
// RUTA SARLAFT OFAC MASIVO
// ============================================================

export default function sarlaftMasivoOFACRoutes(
  getGlobalContext: () => BrowserContext,
) {
  const router = Router();

  router.post(
    "/sarlaft/ofac/masivo",
    async (_req: Request, res: Response): Promise<void> => {
      const personas: SarlaftMasivoItem[] = _req.body;

      console.log(
        `🤖 Iniciando consulta masiva OFAC: ${personas?.length ?? 0} registros`,
      );

      let page: Page | null = null;

      try {
        // ========================================================
        // Validar payload
        // ========================================================

        if (!Array.isArray(personas)) {
          res.status(400).json({
            success: false,
            message: "El payload debe ser un array de personas.",
          });

          return;
        }

        if (personas.length === 0) {
          res.status(400).json({
            success: false,
            message: "No se recibieron registros para consultar.",
          });

          return;
        }

        if (personas.length > 40) {
          res.status(400).json({
            success: false,
            message: "El máximo permitido por petición es de 40 registros.",
          });

          return;
        }

        // ========================================================
        // Obtener contexto global
        // ========================================================

        const globalContext = getGlobalContext();

        if (!globalContext) {
          throw new Error(
            "El contexto global de Playwright no está disponible.",
          );
        }

        // ========================================================
        // Crear una sola pestaña para todo el lote
        // ========================================================

        page = await globalContext.newPage();

        if (!page) {
          throw new Error("No se pudo crear la pestaña de OFAC.");
        }

        // ========================================================
        // Selectores
        // ========================================================

        const nameInputSelector = "#ctl00_MainContent_txtLastName";

        const searchButtonSelector = "#ctl00_MainContent_btnSearch";

        const noResultsSelector = "#ctl00_MainContent_pnlMessage .errormessage";

        const resultsTableSelector = "#gvSearchResults";

        // ========================================================
        // Resultados del lote
        // ========================================================

        const resultados = [];

        // ========================================================
        // Procesar personas una por una
        // ========================================================

        for (const [index, persona] of personas.entries()) {
          console.log(
            `🔎 [${index + 1}/${personas.length}] Consultando: ${persona.nombreCompleto}`,
          );

          try {
            // ----------------------------------------------------
            // Cargar OFAC nuevamente para comenzar limpio
            // ----------------------------------------------------

            await page.goto("https://sanctionssearch.ofac.treas.gov/", {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });

            await page
              .waitForLoadState("networkidle", {
                timeout: 30000,
              })
              .catch(() => {
                console.log("⚠️ OFAC no alcanzó networkidle. Continuamos.");
              });

            // ----------------------------------------------------
            // Ingresar nombre
            // ----------------------------------------------------

            await page.waitForSelector(nameInputSelector, {
              timeout: 5000,
            });

            await page.fill(nameInputSelector, persona.nombreCompleto);

            // ----------------------------------------------------
            // Ejecutar búsqueda
            // ----------------------------------------------------

            await page.waitForSelector(searchButtonSelector, {
              timeout: 5000,
            });

            await page.click(searchButtonSelector);

            // ----------------------------------------------------
            // Esperar resultado
            // ----------------------------------------------------

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

            // ----------------------------------------------------
            // Determinar si hubo coincidencia
            // ----------------------------------------------------

            let coincidencia = false;

            if (result === "RESULTS") {
              coincidencia = true;

              console.log(`🔴 Coincidencia OFAC: ${persona.nombreCompleto}`);
            } else {
              console.log(
                `🟢 Sin coincidencias OFAC: ${persona.nombreCompleto}`,
              );
            }

            // ----------------------------------------------------
            // Screenshot
            // ----------------------------------------------------

            const screenshot = await page.screenshot({
              type: "jpeg",
              quality: 85,
              fullPage: true,
            });

            const screenshotBase64 = screenshot.toString("base64");

            // ----------------------------------------------------
            // Guardar resultado de esta persona
            // ----------------------------------------------------
           
            resultados.push({
              fecha: persona.fecha,
              placa: persona.placa,
              nombreCompleto: persona.nombreCompleto,
              numeroDocumento: persona.numeroDocumento,
              consultaExitosa: true,
              coincidencia,
              screenshot: screenshotBase64,
            });
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : "Error desconocido";

            console.error(
              `❌ Error consultando ${persona.nombreCompleto}:`,
              message,
            );

            // ----------------------------------------------------
            // Si falla una persona, continuamos con las demás
            // ----------------------------------------------------

            resultados.push({
              fecha: persona.fecha,
              placa: persona.placa,
              nombreCompleto: persona.nombreCompleto,
              numeroDocumento: persona.numeroDocumento,
              consultaExitosa: false,
              coincidencia: false,
              screenshot: null,
              error: message,
            });
          }
        }

        // ========================================================
        // Resultado general del lote
        // ========================================================

        const hayCoincidencias = resultados.some(
          (item) => item.coincidencia === true,
        );

        const huboErrores = resultados.some(
          (item) => item.consultaExitosa === false,
        );

        // ========================================================
        // Personas que tuvieron coincidencia
        // ========================================================

        const personasConCoincidencia = resultados
          .filter((item) => item.coincidencia === true)
          .map((item) => ({
            fecha: item.fecha,
            placa: item.placa,
            nombreCompleto: item.nombreCompleto,
          }));

        // ========================================================
        // Respuesta
        // ========================================================

        res.json({
          success: !huboErrores && !hayCoincidencias,
          hayCoincidencias,
          personasConCoincidencia,
          resultados,
        });

        await page.close();

        return;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Error desconocido";

        console.error("❌ Error en consulta masiva OFAC:", message);

        if (page) {
          await page.close().catch(() => {});
        }

        res.status(500).json({
          success: false,
          message: "No se pudo completar la consulta masiva OFAC.",
          error: message,
        });
      }
    },
  );

  return router;
}
