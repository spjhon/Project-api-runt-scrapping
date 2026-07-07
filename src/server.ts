import express, { Request, Response } from 'express';
import { Browser, chromium, Page } from 'playwright'; // Importamos el motor de Chromium de Playwright
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());



// Opción rápida (Permite que CUALQUIER frontend consulte tu API):
app.use(cors());

// Opción recomendada para producción (Solo permite tus dominios específicos):
// app.use(cors({
//   origin: ['http://localhost:3000', 'https://tu-saas-cda.com']
// }));





// Lo declaramos arriba para que esté vivo durante todo el ciclo del servidor
let globalBrowser: Browser | null = null;




// Aquí guardamos las pestañas abiertas de los CDAs que están esperando el captcha
interface RuntSession {
  page: Page;
  createdAt: number;
}
const activeSessions = new Map<string, RuntSession>();




// 5 minutos en milisegundos (5 * 60 * 1000)
const SESSION_TIMEOUT = 15000;




// Función para inicializar el navegador una sola vez al arrancar
async function initGlobalBrowser() {
  if (!globalBrowser) {
    console.log('🌐 Lanzando instancia global de Chromium...');
    globalBrowser = await chromium.launch({ 
      headless: false // Mantenlo en false para ver físicamente cómo se acumulan las pestañas
    });
  }
  return globalBrowser;
}






//funcion limpiadora
async function limpiarSesionesExpiradas() {
  const ahora = Date.now();
  console.log(`🧹 [Limpiador] Revisando sesiones inactivas... (${activeSessions.size} actuales)`);

  for (const [sessionId, session] of activeSessions.entries()) {
    // Si el tiempo actual menos el tiempo de creación supera el límite...
    if (ahora - session.createdAt > SESSION_TIMEOUT) {
      console.log(`⏳ Sesión [${sessionId}] expiró por inactividad. Cerrando pestaña...`);
      
      try {
        // Cerramos la pestaña de Playwright de forma segura
        await session.page.close();
        
        // Si quieres hilar más fino y cerrar también su contexto de incógnito:
        // const context = session.page.context();
        // await context.close();
        
      } catch (error: any) {
        console.error(`Error al cerrar pestaña de sesión expirada [${sessionId}]:`, error.message);
      } finally {
        // Pase lo que pase, la borramos del mapa de memoria RAM
        activeSessions.delete(sessionId);
      }
    }
  }
}









// 1. ENDPOINT PARA VALIDAR LA ENTRADA AL RUNT
app.post('/api/scraper/init', async (req: Request, res: Response): Promise<void> => {


  console.log('🤖 Intentando conectar con el RUNT...');
  
  

  try {

    const browser = await initGlobalBrowser();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });


    const page = await context.newPage();


    // Navegamos al RUNT y esperamos a que no haya más peticiones de red pendientes
    await page.goto('https://www.runt.com.co/consultaCiudadana/#/consultaVehiculo', {
      waitUntil: 'networkidle'
    });

    // 🔑 GENERAMOS UN ID ÚNICO PARA ESTA CONSULTA
    const sessionId = Math.random().toString(36).substring(2, 15);



    // 📌 GUARDAMOS LA PÁGINA EN MEMORIA (NO LA CERRAMOS)
    activeSessions.set(sessionId, {
      page,
      createdAt: Date.now()
    });


    console.log(`📌 Sesión [${sessionId}] guardada. Navegador abierto y esperando captcha.`);




    // Obtenemos el título de la página para confirmar que cargó la correcta
    const pageTitle = await page.title();


    console.log(`✅ ¡Conexión exitosa! Título de la página: "${pageTitle}"`);





// 1. Esperamos a que la imagen del captcha aparezca en el DOM
const captchaSelector = 'img.img-fluid.img-responsive';
await page.waitForSelector(captchaSelector);


// 2. Extraemos el atributo 'src' que ya viene en formato Data URI (Base64)
const captchaBase64 = await page.$eval(captchaSelector, (img) => {
  return (img).src;
}).catch(() => null); // Si no lo encuentra, que retorne null de forma segura

if (!captchaBase64) {
  throw new Error("No se pudo encontrar la imagen del captcha en el RUNT");
}
    

    // Respondemos con éxito al cliente
    res.json({
  success: true,
  sessionId,
  captcha: captchaBase64, // Mandamos el string "data:image/png;base64,..."
  message: 'Navegador retenido y captcha enviado.'
});

  } catch (error: any) {


    console.error('❌ Error al intentar entrar al RUNT:', error.message);
    
    // Si algo falla, nos aseguramos de cerrar el navegador para no dejar procesos fantasmas en tu PC
    //await browser.close();
    
    res.status(500).json({
      success: false,
      message: 'No se pudo conectar con el RUNT',
      error: error.message
    });
  }



});






// Endpoint de prueba existente
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: '¡Servidor de Node + TS corriendo perfectamentes!'
  });
});








app.listen(PORT, async () => {
  console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
  await initGlobalBrowser(); 

  // 🚀 ACTIVA EL LIMPIADOR EN SEGUNDO PLANO
  // Cada 60 segundos ejecutará la función para limpiar la basura
  setInterval(async () => {
    await limpiarSesionesExpiradas();
  }, 15000); 
});