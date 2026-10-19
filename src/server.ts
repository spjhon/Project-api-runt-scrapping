import express, { Request, Response } from "express";
import cors from "cors";
import { chromium, Browser, BrowserContext, Page } from "playwright";

import runtRoutes from "./routes/runt.routes";
import sarlaftOFACRoutes from "./routes/sarlaft-OFAC.routes";
import sarlaftUNRoutes from "./routes/sarlaft-UN.routes";
import sarlaftMasivoOFACRoutes from "./routes/sarlaft-Masivo-Ofac.routes";
import sarlaftMasivoUNRoutes from "./routes/saflaft-Masivo-UN.routes";


const app = express();

const PORT = process.env.PORT || 3001;

// ============================================================
// MIDDLEWARES
// ============================================================

app.use(cors()); //TODO: Agregar resctricciones por que como esta ahora esta muy abierto
app.use(express.json()); //Aqui dice: Si llega una petición con JSON en el body, conviértelo para que pueda acceder a él mediante req.body

// ============================================================
// PLAYWRIGHT
// ============================================================

let browser: Browser;
let globalContext: BrowserContext;
let warmUpPage: Page;

// ============================================================
// INICIALIZACIÓN DEL NAVEGADOR
// ============================================================

async function initializeBrowser() {
  console.log("🚀 Iniciando navegador...");

  browser = await chromium.launch({
    headless: true,
    
  });

  globalContext = await browser.newContext({
    
  });

  // ----------------------------------------------------------
  // Página de Warm-up
  // ----------------------------------------------------------

  warmUpPage = await globalContext.newPage();

  console.log("🔥 Ejecutando warm-up del navegador...");

  try {
    // Navegar esperando a que la red esté más calmada (networkidle) o domcontentloaded
    await warmUpPage.goto(
      "https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000, // Aumentamos el timeout a 60 segundos por si el portal del RUNT está lento
      }
    );

    console.log("⏳ Esperando a que el contenido dinámico del RUNT renderice...");

    // Como el RUNT carga por hashes (#) y componentes de Angular, 
    // esperamos a que aparezca un elemento característico del formulario de consulta (por ejemplo, el campo de placa o el contenedor principal)
    // Cambia este selector si el input de placa tiene otro ID, clase o placeholder específico.
    await warmUpPage.waitForSelector("input, button, form", { 
      state: "visible", 
      timeout: 60000 
    });

    // Breve pausa de estabilización opcional para asegurar que los scripts internos terminen de montar los eventos
    await warmUpPage.waitForTimeout(6000);

    console.log("✅ Warm-up completado con éxito.");
  } catch (error) {
    console.error("❌ Error durante el warm-up del RUNT:", error);
    throw error;
  }
}

// ============================================================
// RUTAS
// ============================================================

// ------------------------------------------------------------
// RUNT
// ------------------------------------------------------------

app.use("/api/scraper", runtRoutes(() => globalContext));

// ------------------------------------------------------------
// SARLAFT OFAC
// ------------------------------------------------------------

app.use("/api/scraper", sarlaftOFACRoutes(() => globalContext));

// ------------------------------------------------------------
// SARLAFT UN
// ------------------------------------------------------------

app.use("/api/scraper", sarlaftUNRoutes(() => globalContext));

// ------------------------------------------------------------
// SARLAFT MASIVO OFAC
// ------------------------------------------------------------

app.use("/api/scraper", sarlaftMasivoOFACRoutes(() => globalContext));

// ------------------------------------------------------------
// SARLAFT MASIVO UN
// ------------------------------------------------------------

app.use("/api/scraper", sarlaftMasivoUNRoutes(() => globalContext));

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Scraper API funcionando correctamente.",
  });
});

// ============================================================
// MANEJO DE ERRORES
// ============================================================

app.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    console.error("❌ Error no controlado:", err);

    res.status(500).json({
      success: false,
      message: "Error interno del servidor.",
    });
  },
);

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  try {
    await initializeBrowser();

    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════╗
║          SCRAPER API INICIADA                ║
╠══════════════════════════════════════════════╣
║ Puerto: ${PORT}                              ║
║ Estado: ONLINE                               ║
╚══════════════════════════════════════════════╝
`);
    });
  } catch (error) {
    console.error("❌ No se pudo iniciar el servidor:", error);

    process.exit(1);
  }
}

startServer();