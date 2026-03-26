import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'POST') {
    try {
      const { id, name, stations } = req.body;
      
      // 1. Skapa grafen (eller uppdatera namnet om den redan finns)
      await sql`
        INSERT INTO graphs (id, name) VALUES (${id}, ${name})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;
      
      // 2. Rensa gamla stationer för denna graf och lägg in de nya
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
