import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const sql = neon(process.env.DATABASE_URL);
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Ej inloggad' });
    }
    try {
        jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Sessionen har gått ut' });
    }

    if (req.method === 'GET') {
        try {
            const { graphId } = req.query;
            const works = await sql`SELECT * FROM works WHERE graph_id = ${graphId}`;
            return res.status(200).json(works);
        } catch (error) { return res.status(500).json({ error: error.message }); }
    }

    if (req.method === 'POST') {
        try {
            const w = req.body;
            await sql`
                INSERT INTO works (
                    id, graph_id, type, label, start_time, end_time, 
                    start_station, end_station, status, track, 
                    end_place, bounds, blocked_area, switches, 
                    consultation, contact_name, contact_phone, details_text, inc_start, inc_end
                ) VALUES (
                    ${w.id}, ${w.graph_id}, ${w.type}, ${w.label}, ${w.start_time}, ${w.end_time}, 
                    ${w.start_station}, ${w.end_station}, ${w.status}, ${w.track || ''}, 
                    ${w.end_place || ''}, ${w.bounds || ''}, ${w.blocked_area || ''}, ${w.switches || ''}, 
                    ${w.consultation || ''}, ${w.contact_name || ''}, ${w.contact_phone || ''}, ${w.details_text || ''},
                    ${w.inc_start}, ${w.inc_end}
                )
                ON CONFLICT (id) DO UPDATE 
                SET type = EXCLUDED.type, label = EXCLUDED.label, status = EXCLUDED.status,
                    start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
                    start_station = EXCLUDED.start_station, end_station = EXCLUDED.end_station,
                    track = EXCLUDED.track, blocked_area = EXCLUDED.blocked_area,
                    inc_start = EXCLUDED.inc_start, inc_end = EXCLUDED.inc_end,
                    switches = EXCLUDED.switches, consultation = EXCLUDED.consultation,
                    contact_name = EXCLUDED.contact_name, contact_phone = EXCLUDED.contact_phone,
                    details_text = EXCLUDED.details_text;
            `;
            return res.status(200).json({ success: true });
        } catch (error) { return res.status(500).json({ error: error.message }); }
    }

    // NYTT: Hantera borttagning av banarbeten
    if (req.method === 'DELETE') {
        try {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'ID saknas' });
            await sql`DELETE FROM works WHERE id = ${id}`;
            return res.status(200).json({ success: true });
        } catch (error) { return res.status(500).json({ error: error.message }); }
    }

    res.status(405).json({ error: 'Metoden tillåts inte' });
}
