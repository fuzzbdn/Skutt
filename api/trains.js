import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // NÄR FRONTEND VILL HÄMTA TÅGEN FÖR EN GRAF (GET)
  if (req.method === 'GET') {
    try {
      const { graphId } = req.query;
      if (!graphId) return res.status(400).json({ error: "graphId saknas" });
      
      // Vi döper om kolumnerna så de matchar din JavaScript-kod exakt
      const rows = await sql`
        SELECT train_id as "id", start_date as "startDate", timetable 
        FROM trains 
        WHERE graph_id = ${graphId}
      `;
      return res.status(200).json(rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // NÄR FRONTEND SPARAR ELLER IMPORTERAR TÅG (POST)
  if (req.method === 'POST') {
    try {
      const { graphId, trains } = req.body;
      
      // 1. Töm gamla tåg för just denna grafen
      await sql`DELETE FROM trains WHERE graph_id = ${graphId}`;
      
      // 2. Lägg in de nya/importerade tågen
      for (let train of trains) {
         await sql`
           INSERT INTO trains (graph_id, train_id, start_date, timetable)
           VALUES (${graphId}, ${train.id}, ${train.startDate}, ${JSON.stringify(train.timetable)})
         `;
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  res.status(405).json({ error: 'Metoden tillåts inte' });
}
