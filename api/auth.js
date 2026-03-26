import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const secret = process.env.JWT_SECRET;

    // REGISTRERA NY ANVÄNDARE
    if (req.method === 'POST' && req.query.action === 'register') {
        try {
            const { username, password } = req.body;
            if (!username || !password) return res.status(400).json({ error: 'Användarnamn och lösenord krävs' });

            // Kryptera lösenordet innan vi sparar det!
            const salt = bcrypt.genSaltSync(10);
            const hashedPassword = bcrypt.hashSync(password, salt);

            // Spara i Neon
            const result = await sql`
                INSERT INTO users (username, password_hash) 
                VALUES (${username}, ${hashedPassword}) 
                RETURNING id, username
            `;
            
            return res.status(200).json({ success: true, user: result[0] });
        } catch (error) {
            // Felkod 23505 betyder "Unique violation" (Användarnamnet finns redan)
            if (error.code === '23505') return res.status(400).json({ error: 'Användarnamnet är upptaget' });
            return res.status(500).json({ error: error.message });
        }
    }

    // LOGGA IN (SKAPA BILJETT)
    if (req.method === 'POST' && req.query.action === 'login') {
        try {
            const { username, password } = req.body;

            // Hämta användaren från Neon
            const users = await sql`SELECT * FROM users WHERE username = ${username}`;
            if (users.length === 0) return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });

            const user = users[0];

            // Kontrollera om lösenordet matchar det krypterade i databasen
            const isMatch = bcrypt.compareSync(password, user.password_hash);
            if (!isMatch) return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });

            // Skapa biljetten (JWT) som gäller i 24 timmar
            const token = jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '24h' });

            return res.status(200).json({ success: true, token, username: user.username });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    res.status(405).json({ error: 'Metoden tillåts inte' });
}
