import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Du måste vara inloggad' });

  let decoded;
  try { decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET); } 
  catch (err) { return res.status(401).json({ error: 'Ogiltig inloggning' }); }
  const userId = decoded.userId;

  if (req.method === 'GET') {
    try {
      const dbGraphs = await sql`SELECT id FROM graphs WHERE user_id = ${userId}`;
      if (dbGraphs.length === 0) return res.status(200).json([]);
      
      const graphIds = dbGraphs.map(g => g.id);
      const dbTrains = await sql`SELECT * FROM trains WHERE graph_id = ANY(${graphIds})`;
      if (dbTrains.length === 0) return res.status(200).json([]);
      
      const trainIds = dbTrains.map(t => t.id);
      const dbStops = await sql`SELECT * FROM train_stops WHERE train_id = ANY(${trainIds})`;
      const trainMap = {};

      dbTrains.forEach(train => {
        const tNum = train.train_number;
        const sDate = train.start_date || 'IngetDatum';
        
        const uniqueKey = `${tNum}_${sDate}`; 

        if (!trainMap[uniqueKey]) {
            trainMap[uniqueKey] = { id: tNum, startDate: train.start_date, timetable: [] };
        }
        
        const stops = dbStops.filter(s => s.train_id === train.id);
        stops.forEach(stop => {
            trainMap[uniqueKey].timetable.push({
                stationSign: stop.station_sign,
                arrival: stop.arrival,
                departure: stop.departure
            });
        });
      });

      Object.values(trainMap).forEach(train => {
          const uniqueStops = [];
          const seen = new Set();
          train.timetable.forEach(stop => {
              const key = `${stop.stationSign}-${stop.arrival}-${stop.departure}`;
              if (!seen.has(key)) { seen.add(key); uniqueStops.push(stop); }
          });
          train.timetable = uniqueStops;
      });

      return res.status(200).json(Object.values(trainMap));
    } catch (error) { return res.status(500).json({ error: error.message }); }
  }

  if (req.method === 'POST') {
    try {
      const { graphId, trains } = req.body;
      const userGraph = await sql`SELECT id FROM graphs WHERE id = ${graphId} AND user_id = ${userId}`;
      if (userGraph.length === 0) return res.status(403).json({error: "Obehörig graf"});

      // 1. Ta bort de gamla tågen för denna graf
      await sql`DELETE FROM trains WHERE graph_id = ${graphId}`;
      
      // 2. Skapa en array med löften ("Promises") för alla nya tåg
      const trainPromises = trains.map(async (train) => {
         const uniqueDbId = `${graphId}_${train.id}_${Math.random().toString(36).substr(2, 5)}`;
         const startDate = train.startDate || null;

         // Skapa själva tåget i databasen först
         await sql`
           INSERT INTO trains (id, graph_id, train_number, start_date)
           VALUES (${uniqueDbId}, ${graphId}, ${train.id}, ${startDate})
         `;

         // 3. Skapa en array med löften för alla hållplatser på just detta tåg
         const stopPromises = train.timetable.map(stop => {
             return sql`
               INSERT INTO train_stops (train_id, station_sign, arrival, departure)
               VALUES (${uniqueDbId}, ${stop.stationSign}, ${stop.arrival}, ${stop.departure})
             `;
         });
         
         // Skjut iväg alla hållplatser för tåget SAMTIDIGT!
         await Promise.all(stopPromises);
      });

      // 4. Säg åt servern att skjuta iväg alla tåg SAMTIDIGT, och vänta tills alla är klara!
      await Promise.all(trainPromises);

      return res.status(200).json({ success: true });
    } catch (error) { 
      return res.status(500).json({ error: error.message }); 
    }
  }
  
  res.status(405).json({ error: 'Metoden tillåts inte' });
}
