import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Koppla upp mot Neon-databasen
  const sql = neon(process.env.DATABASE_URL);

  // OM FRONTEND BER OM ATT FÅ HÄMTA ARBETEN (GET)
  if (req.method === 'GET') {
    try {
      const { graphId } = req.query; // Fångar upp vilken graf vi tittar på
      if (!graphId) return res.status(400).json({ error: "graphId saknas" });

      const works = await sql`SELECT * FROM works WHERE graph_id = ${graphId}`;
      return res.status(200).json(works);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // OM FRONTEND BER OM ATT SPARA ETT ARBETE (POST)
  if (req.method === 'POST') {
    try {
      const { id, graph_id, type, label, start_time, end_time, status } = req.body;
      
      // Upsert: Skapa ny rad, men om 'id' redan finns, uppdatera istället
      await sql`
        INSERT INTO works (id, graph_id, type, label, start_time, end_time, status)
        VALUES (${id}, ${graph_id}, ${type}, ${label}, ${start_time}, ${end_time}, ${status})
        ON CONFLICT (id) DO UPDATE 
        SET type = EXCLUDED.type, label = EXCLUDED.label, status = EXCLUDED.status, 
            start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
      `;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Om någon försöker använda en annan metod (t.ex. DELETE/PUT)
  res.status(405).json({ error: 'Metoden tillåts inte' });
}
