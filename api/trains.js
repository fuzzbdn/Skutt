import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // OM FRONTEND VILL HÄMTA TÅG (GET)
  if (req.method === 'GET') {
    try {
      const { graphId } = req.query;
      if (!graphId) return res.status(400).json({ error: "graphId saknas" });

      // 1. Hämta alla tåg för denna graf
      const dbTrains = await sql`SELECT * FROM trains WHERE graph_id = ${graphId}`;
      
      if (dbTrains.length === 0) return res.status(200).json([]);

      // 2. Hämta alla tillhörande stopp
      const trainIds = dbTrains.map(t => t.id);
      const dbStops = await sql`SELECT * FROM train_stops WHERE train_id = ANY(${trainIds})`;

      // 3. Bygg ihop datan så din frontend känner igen den
      const formattedTrains = dbTrains.map(train => {
        const stops = dbStops
            .filter(stop => stop.train_id === train.id)
            .map(stop => ({
                stationSign: stop.station_sign,
                arrival: stop.arrival,
                departure: stop.departure
            }));

        return {
            id: train.train_number, // train_number i DB blir "id" i frontend
            startDate: train.start_date,
            timetable: stops
        };
      });

      return res.status(200).json(formattedTrains);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // OM FRONTEND VILL SPARA TÅG (POST)
  if (req.method === 'POST') {
    try {
      const { graphId, trains } = req.body;
      
      // 1. Töm gamla tåg för grafen (ON DELETE CASCADE raderar automatiskt stoppen i train_stops!)
      await sql`DELETE FROM trains WHERE graph_id = ${graphId}`;
      
      // 2. Lägg in de nya tågen
      for (let train of trains) {
         // Eftersom flera grafer kan ha ett tåg "91" skapar vi ett unikt ID för databasen
         const uniqueDbId = `${graphId}_${train.id}_${Math.random().toString(36).substr(2, 5)}`;
         const startDate = train.startDate || null;

         await sql`
           INSERT INTO trains (id, graph_id, train_number, start_date)
           VALUES (${uniqueDbId}, ${graphId}, ${train.id}, ${startDate})
         `;

         // 3. Lägg in alla stopp för tåget
         for (let stop of train.timetable) {
             await sql`
               INSERT INTO train_stops (train_id, station_sign, arrival, departure)
               VALUES (${uniqueDbId}, ${stop.stationSign}, ${stop.arrival}, ${stop.departure})
             `;
         }
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  res.status(405).json({ error: 'Metoden tillåts inte' });
}
