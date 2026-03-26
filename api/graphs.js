import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  // 1. KONTROLLERA INLOGGNINGSBILJETTEN (TOKEN)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Du måste vara inloggad' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
      // Lås upp biljetten med samma hemliga lösenord vi skapade i Vercel
      decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
      return res.status(401).json({ error: 'Ogiltig eller utgången inloggning' });
  }

  const userId = decoded.userId; // Här är ID:t på den som klickade!
  const sql = neon(process.env.DATABASE_URL);

  // OM FRONTEND VILL HÄMTA SINA GRAFER (GET)
  if (req.method === 'GET') {
      try {
          // Hämta BARA graferna som tillhör denna användare
          const userGraphs = await sql`SELECT * FROM graphs WHERE user_id = ${userId}`;
          
          if (userGraphs.length === 0) return res.status(200).json([]);

          // Hämta stationerna för dessa grafer
          const graphIds = userGraphs.map(g => g.id);
          const userStations = await sql`SELECT * FROM stations WHERE graph_id = ANY(${graphIds})`;

          // Bygg ihop det snyggt
          const formattedGraphs = userGraphs.map(g => {
              return {
                  id: g.id,
                  name: g.name,
                  stations: userStations.filter(s => s.graph_id === g.id).map(s => ({
                      name: s.name, sign: s.sign, km: parseFloat(s.km)
                  }))
              };
          });

          return res.status(200).json(formattedGraphs);
      } catch (e) {
          return res.status(500).json({ error: e.message });
      }
  }

  // OM FRONTEND SKAPAR/SPARAR EN GRAF (POST)
  if (req.method === 'POST') {
    try {
      const { id, name, stations } = req.body;
      
      // Spara grafen OCH knyt den till användarens ID
      await sql`
        INSERT INTO graphs (id, name, user_id) VALUES (${id}, ${name}, ${userId})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;
      
      await sql`DELETE FROM stations WHERE graph_id = ${id}`;
      
      for (let s of stations) {
         await sql`
           INSERT INTO stations (graph_id, name, sign, km) 
           VALUES (${id}, ${s.name}, ${s.sign}, ${s.km})
         `;
      }
      return res.status(200).json({success: true});
    } catch(e) { 
      return res.status(500).json({error: e.message}); 
    }
  }
  
  res.status(405).json({ error: 'Metoden tillåts inte' });
}
