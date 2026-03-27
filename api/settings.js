import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Du måste vara inloggad' });
    }

    let decoded;
    try { decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET); } 
    catch (err) { return res.status(401).json({ error: 'Ogiltig inloggning' }); }

    const sql = neon(process.env.DATABASE_URL);
    const userId = decoded.userId;

    // HÄMTA INSTÄLLNINGAR
    if (req.method === 'GET') {
        try {
            const settings = await sql`SELECT * FROM user_settings WHERE user_id = ${userId}`;
            if (settings.length > 0) return res.status(200).json(settings[0]);
            // Skicka standardvärden om användaren inte sparat några inställningar än
            return res.status(200).json({ scroll_sensitivity: 0.4, view_duration: 120 });
        } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    // SPARA INSTÄLLNINGAR
    if (req.method === 'POST') {
        try {
            const { scroll_sensitivity, view_duration } = req.body;
            await sql`
                INSERT INTO user_settings (user_id, scroll_sensitivity, view_duration)
                VALUES (${userId}, ${scroll_sensitivity}, ${view_duration})
                ON CONFLICT (user_id) DO UPDATE 
                SET scroll_sensitivity = EXCLUDED.scroll_sensitivity,
                    view_duration = EXCLUDED.view_duration
            `;
            return res.status(200).json({ success: true });
        } catch (e) { return res.status(500).json({ error: e.message }); }
    }
    
    res.status(405).json({ error: 'Metoden tillåts inte' });
}
