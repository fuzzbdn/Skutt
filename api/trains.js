import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

// HJÄLPFUNKTION: Gör om "12:00" till 720, och låter "720" vara 720.
function parseToMins(val) {
    if (typeof val === 'number') return Math.round(val);
    if (typeof val === 'string' && val.includes(':')) {
        const parts = val.split(':');
        return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
    }
    return parseInt(val, 10) || 0;
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // KONTROLLERA INLOGGNING (För att veta VEMS tåg vi ska hämta)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Du måste vara inloggad' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
      return res.status(401).json({ error: 'Ogiltig eller utgången inloggning' });
  }
  const userId = decoded.userId;

  // ==========================================
  // GET: HÄMTA ALLA ANVÄNDARENS TÅG GLOBALT
  // ==========================================
  if (req.method === 'GET') {
    try {
      // 1. Vilka grafer äger användaren?
      const dbGraphs = await sql`SELECT id FROM graphs WHERE user_id = ${userId}`;
      if (dbGraphs.length === 0) return res.status(200).json([]);
      const graphIds = dbGraphs.map(g => g.id);

      // 2. Hämta ALLA tåg från ALLA användarens grafer
      const dbTrains = await sql`SELECT * FROM trains WHERE graph_id = ANY(${graphIds})`;
      if (dbTrains.length === 0) return res.status(200).json([]);
      const trainIds = dbTrains.map(t => t.id);

      // 3. Hämta ALLA stopp för dessa tåg
      const dbStops = await sql`SELECT * FROM train_stops WHERE train_id = ANY(${trainIds})`;

      // 4. Slå ihop hållplatserna till en gemensam, global tidtabell per tågnummer
      const trainMap = {};

      dbTrains.forEach(train => {
        const tNum = train.train_number;
        if (!trainMap[tNum]) {
            trainMap[tNum] = {
                id: tNum,
                startDate: train.start_date,
                timetable: []
            };
        }

        const stops = dbStops.filter(s => s.train_id === train.id);
        stops.forEach(stop => {
            trainMap[tNum].timetable.push({
                stationSign: stop.station_sign,
                arrival: stop.arrival,
                departure: stop.departure
            });
        });
      });

      // 5. Rensa bort eventuella dubbletter (om ett tåg sparats i flera grafer med överlappning)
      Object.values(trainMap).forEach(train => {
          const uniqueStops = [];
          const seen = new Set();
          train.timetable.forEach(stop => {
              const key = `${stop.stationSign}-${stop.arrival}-${stop.departure}`;
              if (!seen.has(key)) {
                  seen.add(key);
                  uniqueStops.push(stop);
              }
          });
          train.timetable = uniqueStops;
      });

      // Skicka tillbaka den globala listan
      return res.status(200).json(Object.values(trainMap));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // POST: SPARA TÅG FRÅN EN SPECIFIK GRAF
  // ==========================================
  if (req.method === 'POST') {
    try {
      const { graphId, trains } = req.body;
      
      // Säkerhetskoll: Äger användaren grafen de sparar till?
      const userGraph = await sql`SELECT id FROM graphs WHERE id = ${graphId} AND user_id = ${userId}`;
      if (userGraph.length === 0) return res.status(403).json({error: "Obehörig graf"});

      // Töm tidigare sparade delsträckor i just denna graf
      await sql`DELETE FROM trains WHERE graph_id = ${graphId}`;
      
      for (let train of trains) {
         const uniqueDbId = `${graphId}_${train.id}_${Math.random().toString(36).substr(2, 5)}`;
         const startDate = train.startDate || null;

         await sql`
           INSERT INTO trains (id, graph_id, train_number, start_date)
           VALUES (${uniqueDbId}, ${graphId}, ${train.id}, ${startDate})
         `;

         for (let stop of train.timetable) {
             // Tvinga till minuter
             const arrMins = parseToMins(stop.arrival);
             const depMins = parseToMins(stop.departure);
             
             await sql`
               INSERT INTO train_stops (train_id, station_sign, arrival, departure)
               VALUES (${uniqueDbId}, ${stop.stationSign}, ${arrMins}, ${depMins})
             `;
         }
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Fel vid sparning av tåg:", error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  res.status(405).json({ error: 'Metoden tillåts inte' });
}
