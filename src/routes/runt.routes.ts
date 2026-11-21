import { Router, Request, Response } from "express";
import { BrowserContext, Page } from "playwright";

// ============================================================
// TIPOS
// ============================================================

interface RuntSession {
  page: Page;
  createdAt: number;
}

// ============================================================
// CONFIGURACIÓN
// ============================================================

const router = Router();

const SESSION_TIMEOUT = 120000;

// ============================================================
// SESIONES ACTIVAS
// ============================================================

const activeSessions = new Map<string, RuntSession>();

// ============================================================
// MAPEO DE DOCUMENTOS
// ============================================================

const MAPEO_DOCUMENTOS: Record<string, string> = {
  cedula_ciudadania: "Cédula Ciudadanía",
  nit: "NIT",
  pasaporte: "Pasaporte",
  cedula_extranjeria: "Cédula de Extranjería",
  tarjeta_identidad: "Tarjeta de Identidad",
  registro_civil: "Registro Civil",
  carnet_diplomatico: "Carnet Diplomático",
  permiso_por_proteccion_temporal: "Permiso por Protección Temporal",
};

// ============================================================
// FUNCIÓN AUXILIAR
// LIMPIAR SESIONES EXPIRADAS
// ============================================================

async function limpiarSesionesExpiradas() {
  const ahora = Date.now();

  for (const [sessionId, session] of activeSessions.entries()) {
    if (ahora - session.createdAt > SESSION_TIMEOUT) {
      console.log(
        `⏳ Sesión [${sessionId}] expiró. Cerrando su pestaña secundaria...`,
      );

      try {
        await session.page.close().catch(() => {});
      } catch (error: any) {
        console.error(
          `Error al cerrar pestaña de la sesión [${sessionId}]:`,
          error.message,
        );
      } finally {
        activeSessions.delete(sessionId);
      }
    }
  }
}

// ============================================================
// ROUTES FACTORY
// ============================================================
//
// Recibimos una función que nos entrega el BrowserContext
// inicializado desde server.ts.
//
// Esto evita importar server.ts desde aquí y crear dependencias
// circulares.
// ============================================================

export default function createRuntRoutes(
  getGlobalContext: () => BrowserContext,
) {
  // ==========================================================
  // 1. ENDPOINT INIT
  // ==========================================================
  //
  // Abre una pestaña secundaria dentro del contexto global
  // precalentado y obtiene el captcha.
  //
  // Endpoint final:
  //
  // POST /api/scraper/init
  //
  // ==========================================================

  router.post(
    "/init",
    async (_req: Request, res: Response): Promise<void> => {
      console.log("🤖 Creando pestaña temporal para consulta...");

      let page: Page | null = null;
      let sessionId: string | null = null;

      try {
        // ------------------------------------------------------
        // Obtener contexto global
        // ------------------------------------------------------

        const globalContext = getGlobalContext();

        if (!globalContext) {
          throw new Error("El contexto global de Playwright no está disponible.");
        }

        // ------------------------------------------------------
        // Crear pestaña secundaria
        // ------------------------------------------------------

        page = await globalContext.newPage();

        if (!page) {
          throw new Error("No se pudo instanciar la pestaña.");
        }

        // ------------------------------------------------------
        // Entrar al portal RUNT
        // ------------------------------------------------------

        await page.goto(
          "https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana",
        );

        // ------------------------------------------------------
        // Crear ID de sesión
        // ------------------------------------------------------

        sessionId = Math.random().toString(36).substring(2, 15);

        activeSessions.set(sessionId, {
          page,
          createdAt: Date.now(),
        });

        console.log(
          `📌 Pestaña [${sessionId}] lista. Obteniendo captcha...`,
        );

        // ------------------------------------------------------
        // Esperar captcha
        // ------------------------------------------------------

        const captchaSelector =
          "div.col-md-12:nth-child(3) > img:nth-child(1)";

        await page.waitForSelector(captchaSelector, {
          timeout: 40000,
        });

        // ------------------------------------------------------
        // Obtener captcha
        // ------------------------------------------------------

        const captchaBase64 = await page
          .$eval(captchaSelector, (img: any) => img.src)
          .catch(() => null);

        if (!captchaBase64) {
          throw new Error(
            "No se pudo encontrar la imagen del captcha en el RUNT",
          );
        }

        // ------------------------------------------------------
        // Respuesta
        // ------------------------------------------------------

        res.json({
          success: true,
          sessionId,
          captcha: captchaBase64,
          message: "Pestaña lista y captcha enviado.",
        });
      } catch (error: any) {
        console.error(
          "❌ Error al intentar entrar al RUNT:",
          error.message,
        );

        if (page) {
          await page.close().catch(() => {});
        }

        if (sessionId) {
          activeSessions.delete(sessionId);
        }

        res.status(500).json({
          success: false,
          message: "No se pudo conectar con el RUNT",
          error: error.message,
        });
      }
    },
  );

  // ==========================================================
  // 2. ENDPOINT SOLVE
  // ==========================================================
  //
  // Recibe:
  // - sessionId
  // - tipoDocumento
  // - numeroDocumento
  // - captchaValue
  // - placa
  //
  // Utiliza la pestaña creada en /init, realiza la consulta,
  // extrae los datos y finalmente cierra únicamente esa pestaña.
  //
  // Endpoint final:
  //
  // POST /api/scraper/solve
  //
  // ==========================================================

  router.post(
    "/solve",
    async (req: Request, res: Response): Promise<void> => {
      const {
        sessionId,
        tipoDocumento,
        numeroDocumento,
        captchaValue,
        placa,
      } = req.body;

      // --------------------------------------------------------
      // Buscar sesión
      // --------------------------------------------------------

      const session = activeSessions.get(sessionId);

      if (!session) {
        res.status(400).json({
          success: false,
          message:
            "La sesión del navegador expiró o no existe. Por favor, recarga el captcha.",
        });

        return;
      }

      const { page } = session;

      try {
        console.log(
          `🚀 Procesando consulta RUNT para Placa: ${placa}...`,
        );

        // ======================================================
        // PLACA
        // ======================================================

        await page.click("#mat-input-0");

        await page.keyboard.press("Control+A");

        await page.keyboard.press("Backspace");

        await page.fill("#mat-input-0", placa.toUpperCase());

        // ======================================================
        // TIPO DE DOCUMENTO
        // ======================================================

        const textoDocumentoRunt =
          MAPEO_DOCUMENTOS[tipoDocumento] || "Cédula Ciudadanía";

        await page.click("#mat-select-4");

        const opcionSelector = `mat-option:has-text("${textoDocumentoRunt}")`;

        await page.waitForSelector(opcionSelector, {
          timeout: 3000,
        });

        await page.click(opcionSelector);

        // ======================================================
        // NÚMERO DE DOCUMENTO
        // ======================================================

        await page.fill("#mat-input-1", numeroDocumento);

        // ======================================================
        // CAPTCHA
        // ======================================================

        await page.fill("#mat-input-2", captchaValue);

        // ======================================================
        // CONSULTAR
        // ======================================================

        const botonConsultar =
          'button:has-text("Consultar"), button[type="submit"]';

        await page.click(botonConsultar);

        console.log(
          "⏳ Esperando respuesta de la consulta en el portal del RUNT...",
        );

        // ======================================================
        // SELECTORES DE RESPUESTA
        // ======================================================

        const selectorServicio =
          "body > host-runt-root > app-layout > app-theme-runt2 > mat-sidenav-container > mat-sidenav-content > div > ng-component > div > div > div:nth-child(2) > div:nth-child(2) > cyrconsultavehiculo-info-vehiculo-detallada > div > div:nth-child(1) > div.panel-content > div > div > div:nth-child(3) > div:nth-child(2) > b";

        const selectorAlertaError = ".swal2-popup";

        const elementoGanador = await Promise.race([
          page
            .waitForSelector(selectorServicio, {
              timeout: 12000,
            })
            .then(() => "DATOS_OK"),

          page
            .waitForSelector(selectorAlertaError, {
              timeout: 12000,
            })
            .then(() => "ERROR_RUNT"),
        ]).catch((err) => {
          throw new Error(
            `Tiempo de espera agotado sin respuesta del portal: ${err.message}`,
          );
        });

        // ======================================================
        // ERROR DEVUELTO POR RUNT
        // ======================================================

        if (elementoGanador === "ERROR_RUNT") {
          console.log(
            "⚠️ Se detectó una alerta de error en el portal del RUNT.",
          );

          const textoErrorRunt = await page
            .$eval(
              "#swal2-html-container",
              (el) => el.textContent?.trim(),
            )
            .catch(() => null);

          res.status(200).json({
            success: false,
            message:
              textoErrorRunt ||
              "Error desconocido devuelto por el portal del RUNT.",
          });

          return;
        }

        // ======================================================
        // TIPO DE SERVICIO
        // ======================================================

 const tipoServicioRaw = await page.$eval(
  selectorServicio,
  (el) => el.textContent,
);

let tipoServicio = tipoServicioRaw
  ? tipoServicioRaw.trim().toLowerCase()
  : "";

if (tipoServicio === "público") {
  tipoServicio = "publico";
}

        // ======================================================
        // CLASE DEL VEHÍCULO
        // ======================================================

        const selectorClaseVehiculo =
          "div.panel-soat:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(3) > div:nth-child(4) > b:nth-child(1)";

        const claseVehiculoRaw = await page.$eval(
          selectorClaseVehiculo,
          (el) => el.textContent,
        );

        const claseVehiculo = claseVehiculoRaw
          ? claseVehiculoRaw.trim().toLowerCase()
          : "";

        // ======================================================
        // SOAT
        // ======================================================

        const botonDesplegableSoat =
          'mat-expansion-panel-header:has-text("SOAT"), mat-panel-title:has-text("SOAT")';

        await page.click(botonDesplegableSoat);

        const selectorCeldaSoat = "mat-cell.mat-cell:nth-child(4)";

        await page.waitForSelector(selectorCeldaSoat, {
          timeout: 5000,
        });

        const selectorSOATvigenteDeAcuerdoAlRUNT =
          "#cdk-accordion-child-1 > div > mat-card-content > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-estado.mat-column-estado.ng-star-inserted";

        const SOATvigenteDeAcuerdoAlRUNT = await page.$eval(
          selectorSOATvigenteDeAcuerdoAlRUNT,
          (el) => el.textContent?.trim() || "",
        );

        const SOATvigenteDeAcuerdoAlRUNTformateado =
          SOATvigenteDeAcuerdoAlRUNT
            .replace(/cancel|check_circle/gi, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();

        const soatRaw = await page.$eval(
          selectorCeldaSoat,
          (el) => el.textContent,
        );

        const soat = soatRaw ? soatRaw.trim() : "";

        let soatFormateado = "";

        if (soat && soat.includes("/")) {
          const [dia, mes, anio] = soat.split("/");

          soatFormateado = `${anio}-${mes}-${dia}`;
        }

        // ======================================================
        // MARCA
        // ======================================================

        const selectorMarcaVehiculo =
          "div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > b:nth-child(1)";

        const marcaVehiculoRaw = await page.$eval(
          selectorMarcaVehiculo,
          (el) => el.textContent,
        );

        const marcaVehiculo = marcaVehiculoRaw
          ? marcaVehiculoRaw.trim()
          : "";

        // ======================================================
        // LÍNEA
        // ======================================================

        const selectorLineaVehiculo =
          "div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(4) > b:nth-child(1)";

        const lineaVehiculoRaw = await page.$eval(
          selectorLineaVehiculo,
          (el) => el.textContent,
        );

        const lineaVehiculo = lineaVehiculoRaw
          ? lineaVehiculoRaw.trim()
          : "";

        // ======================================================
        // MODELO
        // ======================================================

        const selectorModeloVehiculo =
          "div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(2) > b:nth-child(1)";

        const ModeloVehiculoRaw = await page.$eval(
          selectorModeloVehiculo,
          (el) => el.textContent,
        );

        const modeloVehiculo = ModeloVehiculoRaw
          ? ModeloVehiculoRaw.trim()
          : "";

        // ======================================================
        // COLOR
        // ======================================================

        const selectorColorVehiculo =
          "div.panel-soat:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > div:nth-child(4) > b:nth-child(1)";

        const colorVehiculoRaw = await page.$eval(
          selectorColorVehiculo,
          (el) => el.textContent,
        );

        const colorVehiculo = colorVehiculoRaw
          ? colorVehiculoRaw.trim()
          : "";

        // ======================================================
        // CILINDRADA
        // ======================================================

        const selectorCilindradaVehiculo =
          "div.row:nth-child(5) > div:nth-child(2) > b:nth-child(1)";

        const cilindradaVehiculoRaw = await page.$eval(
          selectorCilindradaVehiculo,
          (el) => el.textContent,
        );

        const cilindradaVehiculo = cilindradaVehiculoRaw
          ? cilindradaVehiculoRaw.trim()
          : "";

        // ======================================================
        // COMBUSTIBLE
        // ======================================================

        const selectorCombustibleVehiculo =
          "div.row:nth-child(6) > div:nth-child(2) > b:nth-child(1)";

        const combustibleVehiculoRaw = await page.$eval(
          selectorCombustibleVehiculo,
          (el) => el.textContent,
        );

        const combustibleVehiculo = combustibleVehiculoRaw
          ? combustibleVehiculoRaw.trim().toLowerCase()
          : "";

        // ======================================================
        // VEHÍCULO DE ENSEÑANZA
        // ======================================================

        const selectorEnsenanzaVehiculo =
          "div.row:nth-child(6) > div:nth-child(2) > b:nth-child(1)";

        const ensenanzaVehiculoRaw = await page.$eval(
          selectorEnsenanzaVehiculo,
          (el) => el.textContent,
        );

        const ensenanzaVehiculo =
          ensenanzaVehiculoRaw.trim().toLowerCase() === "si";

        // ======================================================
        // DATOS TÉCNICOS DEL VEHÍCULO
        // ======================================================

        const botonDesplegableDatosTecnicosDelVehiculo =
          "div.mt-4:nth-child(3)";

        await page.click(
          botonDesplegableDatosTecnicosDelVehiculo,
        );

        // ======================================================
        // CAPACIDAD DE PASAJEROS
        // ======================================================

        const selectorCeldaCapacidadPasajeros =
          "div.panel-content:nth-child(1) > div:nth-child(2) > div:nth-child(4) > b:nth-child(1)";

        await page.waitForSelector(
          selectorCeldaCapacidadPasajeros,
          {
            timeout: 5000,
          },
        );

        const capacidadPasajerosRaw = await page.$eval(
          selectorCeldaCapacidadPasajeros,
          (el) => el.textContent,
        );

        const capacidadPasajeros = capacidadPasajerosRaw
          ? capacidadPasajerosRaw.trim()
          : "";

        // ======================================================
        // FECHA DE MATRÍCULA
        // ======================================================

        const selectorFechaMatricula =
          "body > host-runt-root > app-layout > app-theme-runt2 > mat-sidenav-container > mat-sidenav-content > div > ng-component > div > div > div:nth-child(2) > div:nth-child(2) > cyrconsultavehiculo-info-vehiculo-detallada > div > div:nth-child(2) > div > div.panel-content > div.col-lg-12 > div:nth-child(6) > div.col-xs-12.col-md-3.col-sm-3.show-grande.td-icon-date > b";

        const fechaMatricula = await page.$eval(
          selectorFechaMatricula,
          (el) => el.textContent?.trim() || "",
        );

        let fechaMatriculaFormateado = "";

        if (fechaMatricula && fechaMatricula.includes("/")) {
          const [dia, mes, anio] = fechaMatricula.split("/");

          fechaMatriculaFormateado = `${anio}-${mes}-${dia}`;
        }

        console.log(
          "📅 Fecha matrícula del vehículo:",
          fechaMatriculaFormateado,
        );

        // ======================================================
        // RTM VIGENTE
        // ======================================================

        const botonDesplegableRTMvigente =
          "div.mt-4:nth-child(7)";

        

        await page.waitForSelector(
          botonDesplegableRTMvigente,
          {
            timeout: 10000,
          },
        );

        await page.click(botonDesplegableRTMvigente);

        const selectorFechaDeVencimiento =
          "#cdk-accordion-child-2 > div > mat-card-content > div > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-fechaVigencia.mat-column-fechaVigencia.ng-star-inserted";

        const selectorOrganismoQueExpidioUltimaRTM =
          "#cdk-accordion-child-2 > div > mat-card-content > div > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-nombreCda.mat-column-nombreCda.ng-star-inserted";

        const selectorVigenteRTMenelRunt =
          "#cdk-accordion-child-2 > div > mat-card-content > div > div > mat-table > mat-row:nth-child(2) > mat-cell.mat-cell.cdk-cell.cdk-column-vigente.mat-column-vigente.ng-star-inserted";

        let fechaVencimientoRTMFormateado = "";
        let organismoQueExpidioUltimaRTM = "";
        let vigenteRTMenelRunt = "";
        let seEncontroFechaRTMenRUNT = "";

        try {
          // ----------------------------------------------------
          // Esperar selector
          // ----------------------------------------------------

          await page.waitForSelector(
            selectorFechaDeVencimiento,
            {
              timeout: 5000,
            },
          );

          console.log(
            "✅ Selector para la fecha de vencimiento de la RTM encontrado",
          );

          // ----------------------------------------------------
          // Extraer datos
          // ----------------------------------------------------

          const fechaVencimientoRTM = await page.$eval(
            selectorFechaDeVencimiento,
            (el) => el.textContent?.trim() || "",
          );

          organismoQueExpidioUltimaRTM = await page.$eval(
            selectorOrganismoQueExpidioUltimaRTM,
            (el) => el.textContent?.trim() || "",
          );

          vigenteRTMenelRunt = await page.$eval(
            selectorVigenteRTMenelRunt,
            (el) => el.textContent?.trim() || "",
          );

          // ----------------------------------------------------
          // Formatear fecha
          // ----------------------------------------------------

          if (
            fechaVencimientoRTM &&
            fechaVencimientoRTM.includes("/")
          ) {
            const [dia, mes, anio] =
              fechaVencimientoRTM.split("/");

            fechaVencimientoRTMFormateado =
              `${anio}-${mes}-${dia}`;
          }

          seEncontroFechaRTMenRUNT = "SI";
        } catch (_error) {
          // Sin RTM encontrada
          seEncontroFechaRTMenRUNT = "NO";
        }


        console.log("Fecha del rtm de acuerdo al runt: ", vigenteRTMenelRunt)







/** 

console.log("📦 Datos extraídos del RUNT:", {
  tipo_servicio: tipoServicio,
  clase_vehiculo: claseVehiculo,
  soat: soatFormateado,
  marca_vehiculo: marcaVehiculo,
  lineaVehiculo,
  modelo_vehiculo: modeloVehiculo,
  color_vehiculo: colorVehiculo,
  cilindrada_vehiculo: cilindradaVehiculo,
  combustible_vehiculo: combustibleVehiculo,
  es_ensenanza: ensenanzaVehiculo,
  capacidad_pasajeros: capacidadPasajeros,
  se_encontro_fecha_vencimiento_RTM: seEncontroFechaRTMenRUNT,
  fecha_vencimiento_RTM: fechaVencimientoRTMFormateado,
  organismo_que_expidio_la_ultima_RTM: organismoQueExpidioUltimaRTM,
  RTM_vigente_de_acuerdo_al_runt: vigenteRTMenelRunt,
  fecha_matricula: fechaMatriculaFormateado,
  SOAT_vigente_de_acuerdo_al_RUNT: SOATvigenteDeAcuerdoAlRUNTformateado,
});

*/




       
        // ======================================================
        // RESPUESTA FINAL
        // ======================================================

        res.json({
          success: true,

          message:
            "Datos extraídos correctamente desde el RUNT",

          payload: {
            tipo_servicio: tipoServicio,

            clase_vehiculo: claseVehiculo,

            soat: soatFormateado,

            marca_vehiculo: marcaVehiculo,

            lineaVehiculo,

            modelo_vehiculo: modeloVehiculo,

            color_vehiculo: colorVehiculo,

            cilindrada_vehiculo: cilindradaVehiculo,

            combustible_vehiculo: combustibleVehiculo,

            es_ensenanza: ensenanzaVehiculo,

            capacidad_pasajeros: capacidadPasajeros,

            se_encontro_fecha_vencimiento_RTM:
              seEncontroFechaRTMenRUNT,

            fecha_vencimiento_RTM:
              fechaVencimientoRTMFormateado,

            organismo_que_expidio_la_ultima_RTM:
              organismoQueExpidioUltimaRTM,

            RTM_vigente_de_acuerdo_al_runt:
              vigenteRTMenelRunt,

            fecha_matricula:
              fechaMatriculaFormateado,

            SOAT_vigente_de_acuerdo_al_RUNT:
              SOATvigenteDeAcuerdoAlRUNTformateado,
          },
        });
      } catch (error: any) {
        console.error(
          `💥 Error en la ejecución para la sesión [${sessionId}]:`,
          error.message,
        );

        res.status(500).json({
          success: false,
          message: `Error interactuando con el RUNT: ${error.message}`,
        });
      } finally {
        // ======================================================
        // CERRAR ÚNICAMENTE LA PESTAÑA DE ESTA SESIÓN
        // ======================================================

        console.log(
          `🧹 Cerrando pestaña secundaria de la sesión [${sessionId}]...`,
        );

        await page.close().catch(() => {});

        activeSessions.delete(sessionId);
      }
    },
  );

  // ==========================================================
  // LIMPIADOR DE SESIONES
  // ==========================================================
  //
  // Lo ejecutamos cada 60 segundos.
  //
  // ==========================================================

  setInterval(async () => {
    await limpiarSesionesExpiradas();
  }, 120000);

  // ==========================================================
  // RETURN ROUTER
  // ==========================================================

  return router;
}