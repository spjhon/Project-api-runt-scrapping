import { Router, Request, Response } from "express";
import { BrowserContext, Page } from "playwright";

// ============================================================
// TIPO DE CADA REGISTRO RECIBIDO
// ============================================================

type SarlaftMasivoUNItem = {
  fecha: string;
  placa: string;
  nombreCompleto: string;
  numeroDocumento: string;
};

// ============================================================
// RUTA SARLAFT NACIONES UNIDAS MASIVO
// ============================================================

export default function sarlaftMasivoUNRoutes(
  getGlobalContext: () => BrowserContext,
) {
  const router = Router();

  router.post(
    "/sarlaft/un/masivo",
    async (_req: Request, res: Response): Promise<void> => {
      const personas: SarlaftMasivoUNItem[] = _req.body;

      console.log(
        `🤖 Iniciando consulta masiva ONU: ${
          personas?.length ?? 0
        } registros`,
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
          throw new Error(
            "No se pudo crear la pestaña de Naciones Unidas.",
          );
        }

        // ========================================================
        // Selectores
        // ========================================================

        const searchInputSelector =
          "#root > div > div > form > div.search-inputs-container > " +
          "div.search-inputfield-container > div > div > input";

        const searchButtonSelector =
          "#root > div > div > form > div.search-inputs-container > " +
          "div.search-btns > button";

        const totalCountSelector =
          "#root > div > div.pagination-container > div > " +
          "div.total-results > span";

        // ========================================================
        // Resultados del lote
        // ========================================================

        const resultados = [];

        // ========================================================
        // Procesar personas una por una
        // ========================================================

        for (const [index, persona] of personas.entries()) {
          console.log(
            `🔎 [${index + 1}/${personas.length}] Consultando ONU: ${
              persona.numeroDocumento
            } - ${persona.nombreCompleto}`,
          );

          try {
            // ----------------------------------------------------
            // Cargar ONU nuevamente para comenzar limpio
            // ----------------------------------------------------

            await page.goto(
              "https://search.sanctions.un.org/",
              {
                waitUntil: "domcontentloaded",
                timeout: 30000,
              },
            );

            await page
              .waitForLoadState("networkidle", {
                timeout: 30000,
              })
              .catch(() => {
                console.log(
                  "⚠️ Naciones Unidas no alcanzó networkidle. Continuamos.",
                );
              });

            // ----------------------------------------------------
            // Esperar input
            // ----------------------------------------------------

            await page.waitForSelector(
              searchInputSelector,
              {
                timeout: 5000,
              },
            );

            // ----------------------------------------------------
            // Buscar por número de documento
            // ----------------------------------------------------

            await page.fill(
              searchInputSelector,
              persona.numeroDocumento,
            );

            console.log(
              `✅ Documento ingresado: ${persona.numeroDocumento}`,
            );

            // ----------------------------------------------------
            // Ejecutar búsqueda
            // ----------------------------------------------------

            await page.waitForSelector(
              searchButtonSelector,
              {
                timeout: 5000,
              },
            );

            await page.click(searchButtonSelector);

            console.log("🔎 Búsqueda enviada a Naciones Unidas.");

            // ----------------------------------------------------
            // Esperar el contador de resultados
            // ----------------------------------------------------

            await page.waitForSelector(
              totalCountSelector,
              {
                timeout: 10000,
              },
            );

            const totalCountText = await page
              .locator(totalCountSelector)
              .textContent();

            const totalCount = Number(
              totalCountText
                ?.replace("Total:", "")
                .trim() ?? "0",
            );

            const coincidencia = totalCount > 0;

            // ----------------------------------------------------
            // Registrar resultado
            // ----------------------------------------------------

            if (coincidencia) {
              console.log(
                `🔴 Coincidencia ONU: ${persona.numeroDocumento}`,
              );
            } else {
              console.log(
                `🟢 Sin coincidencias ONU: ${persona.numeroDocumento}`,
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

            const screenshotBase64 =
              screenshot.toString("base64");

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
              error instanceof Error
                ? error.message
                : "Error desconocido";

            console.error(
              `❌ Error consultando ONU para ${
                persona.nombreCompleto
              }:`,
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
        // Personas con coincidencia
        // ========================================================

        const personasConCoincidencia = resultados
          .filter((item) => item.coincidencia === true)
          .map((item) => ({
            fecha: item.fecha,
            placa: item.placa,
            nombreCompleto: item.nombreCompleto,
            numeroDocumento: item.numeroDocumento,
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
          error instanceof Error
            ? error.message
            : "Error desconocido";

        console.error(
          "❌ Error en consulta masiva ONU:",
          message,
        );

        if (page) {
          await page.close().catch(() => {});
        }

        res.status(500).json({
          success: false,
          message:
            "No se pudo completar la consulta masiva de Naciones Unidas.",
          error: message,
        });
      }
    },
  );

  return router;
}