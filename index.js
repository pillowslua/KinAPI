// index.js (API Server cho KinAPI - Ngon, Chất, Bảo Mật)
require('dotenv').config(); // Load biến môi trường từ .env (cho GITHUB_ACCESS_TOKEN và PORT)

const express = require('express');
const cors = require('cors'); // Để xử lý CORS nếu frontend gọi từ domain khác
const { Octokit } = require('@octokit/rest'); // Thư viện để tương tác với GitHub API
const rateLimit = require('express-rate-limit'); // Để giới hạn số request đến API này

const app = express();
const port = process.env.PORT || 3000; // Cổng server (Replit sẽ tự cấp PORT)

// ===============================================
// CẤU HÌNH API VÀ GITHUB Ở ĐÂY NÈ BRO!
// ===============================================
const GITHUB_CONFIG = {
    owner: 'YOUR_GITHUB_USERNAME', // THAY BẰNG USERNAME GITHUB CỦA MÀY
    repo: 'KinAPI',             // THAY BẰNG TÊN REPO MÀY VỪA TẠO TRÊN GITHUB
    filePath: 'banned_ips.json',    // Tên file JSON chứa IP bị ban trong repo
    branch: 'main'                  // Tên nhánh GitHub (thường là main hoặc master)
};

const DEFAULT_BAN_DURATION_SECONDS = 5 * 60; // Mặc định ban 5 phút

// Khởi tạo Octokit (để tương tác với GitHub API)
const octokit = new Octokit({
    auth: process.env.GITHUB_ACCESS_TOKEN // Lấy token từ biến môi trường (Secrets trên Replit)
});

// ===============================================
// MIDDLEWARE CƠ BẢN VÀ BẢO MẬT
// ===============================================

// Middleware để parse JSON body từ request
app.use(express.json());

// Middleware CORS: Quan trọng để frontend của mày có thể gọi API này từ domain khác (ví dụ kithub.vercel.app)
app.use(cors({
    origin: '*', // Cho phép mọi domain truy cập (cho dễ test). TRONG PRODUCTION NÊN THAY BẰNG DOMAIN CỦA MÀY!
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate Limiting cho API server này (để tránh bị spam chính API của mình)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 100, // Mỗi IP chỉ được 100 request trong 15 phút
    message: 'HaiGPT API: Mày gửi request nhanh quá đó bro! Đợi xíu đi!',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => {
        // Lấy IP của client. Quan trọng: nếu server của mày đứng sau proxy (như Cloudflare, Vercel),
        // thì req.ip sẽ là IP của proxy. req.headers['x-forwarded-for'] sẽ là IP thật của client.
        // Mày có thể cần app.set('trust proxy', true) trong Express để req.ip trả về IP thật.
        return req.headers['x-forwarded-for'] || req.ip;
    }
});
app.use(apiLimiter); // Áp dụng rate limiter cho tất cả các route

// ===============================================
// HÀM HELPER CHO GITHUB FILE OPS (AN TOÀN VÀ CHẤT LƯỢNG)
// ===============================================

/**
 * Lấy nội dung hiện tại của file banned_ips.json từ GitHub.
 * @returns {Array} Mảng các IP bị ban.
 */
async function getBannedIpsFromGithub() {
    try {
        const response = await octokit.repos.getContent({
            owner: GITHUB_CONFIG.owner,
            repo: GITHUB_CONFIG.repo,
            path: GITHUB_CONFIG.filePath,
            ref: GITHUB_CONFIG.branch
        });

        // Nội dung file được mã hóa base64
        const contentBase64 = response.data.content;
        const content = Buffer.from(contentBase64, 'base64').toString('utf8');
        const sha = response.data.sha; // Cần SHA để cập nhật file

        console.log(`[GitHub]: Đã đọc file ${GITHUB_CONFIG.filePath}. SHA: ${sha}`);
        return { data: JSON.parse(content), sha: sha };

    } catch (error) {
        if (error.status === 404) {
            console.warn(`[GitHub]: File ${GITHUB_CONFIG.filePath} không tồn tại. Khởi tạo rỗng.`);
            // File không tồn tại, trả về mảng rỗng và null SHA
            return { data: [], sha: null };
        }
        console.error(`[GitHub]: Lỗi khi đọc file ${GITHUB_CONFIG.filePath}:`, error.message);
        throw new Error(`Không thể đọc file banned_ips.json từ GitHub: ${error.message}`);
    }
}

/**
 * Cập nhật file banned_ips.json trên GitHub.
 * @param {Array} newBannedIps Mảng IP bị ban đã cập nhật.
 * @param {string | null} currentSha SHA hiện tại của file (null nếu file chưa tồn tại).
 */
async function updateBannedIpsOnGithub(newBannedIps, currentSha) {
    const content = JSON.stringify(newBannedIps, null, 2); // Định dạng JSON đẹp

    try {
        const commitMessage = currentSha 
            ? `Cập nhật danh sách IP bị ban (${newBannedIps.length} entries)` 
            : `Tạo file banned_ips.json (${newBannedIps.length} entries)`;

        const commitOptions = {
            owner: GITHUB_CONFIG.owner,
            repo: GITHUB_CONFIG.repo,
            path: GITHUB_CONFIG.filePath,
            message: commitMessage,
            content: Buffer.from(content).toString('base64'), // Mã hóa base64 lại
            branch: GITHUB_CONFIG.branch
        };

        if (currentSha) {
            commitOptions.sha = currentSha; // Chỉ định SHA để cập nhật file cũ
        }

        await octokit.repos.createOrUpdateFileContents(commitOptions);
        console.log(`[GitHub]: Đã cập nhật file ${GITHUB_CONFIG.filePath} thành công!`);

    } catch (error) {
        console.error(`[GitHub]: Lỗi khi cập nhật file ${GITHUB_CONFIG.filePath}:`, error.message);
        throw new Error(`Không thể ghi file banned_ips.json lên GitHub: ${error.message}`);
    }
}

// ===============================================
// ĐỊNH NGHĨA CÁC ĐIỂM CUỐI (API Endpoints) CỦA MÀY
// ===============================================

// API đơn giản để kiểm tra server có chạy không
// Mày có thể truy cập: <URL Replit của mày>/
app.get('/', (req, res) => {
  res.send('HaiGPT API Server đang chạy ngon lành trên Replit! Welcome bro!');
});

// Endpoint để nhận IP bị ban từ frontend và ghi vào GitHub
// Mày sẽ gửi POST request đến: <URL Replit của mày>/api/ban-ip
// Body: { "ip": "192.168.1.1", "reason": "spam", "banDuration": 300 }
app.post('/api/ban-ip', async (req, res) => {
    const { ip, reason, banDuration } = req.body;
    const clientReqIp = req.headers['x-forwarded-for'] || req.ip; // Lấy IP của request gửi đến API này

    if (!ip) {
        return res.status(400).json({ error: 'IP là bắt buộc đó bro!' });
    }

    try {
        const { data: bannedIps, sha: currentSha } = await getBannedIpsFromGithub();
        
        const now = Date.now();
        const banExpiry = now + (banDuration || DEFAULT_BAN_DURATION_SECONDS) * 1000;

        // Lọc bỏ các IP đã hết hạn ban
        const activeBans = bannedIps.filter(ban => ban.banExpiry && ban.banExpiry > now);

        let ipFound = false;
        // Kiểm tra và cập nhật IP nếu đã có trong danh sách
        const updatedBans = activeBans.map(ban => {
            if (ban.ip === ip) {
                ipFound = true;
                // Nếu IP đã tồn tại, cập nhật thời gian hết hạn ban
                console.log(`[BAN]: Cập nhật thời gian ban cho IP ${ip}.`);
                return { ...ban, banExpiry: Math.max(ban.banExpiry, banExpiry), reason: reason || ban.reason, timestamp: now };
            }
            return ban;
        });

        if (!ipFound) {
            // Nếu IP chưa có trong danh sách, thêm mới
            const newBanEntry = {
                ip: ip,
                reason: reason || 'Unknown',
                bannedAt: now,
                banDuration: banDuration || DEFAULT_BAN_DURATION_SECONDS,
                banExpiry: banExpiry
            };
            updatedBans.push(newBanEntry);
            console.log(`[BAN]: Ghi nhận IP mới bị ban: ${ip}`);
        }

        await updateBannedIpsOnGithub(updatedBans, currentSha);

        res.status(200).json({ message: `IP ${ip} đã được ghi nhận để ban trên GitHub.`, status: 'success' });

    } catch (error) {
        console.error(`[API Error]: Xử lý ban IP lỗi:`, error.message);
        res.status(500).json({ error: `Không thể ghi nhận IP ban: ${error.message}` });
    }
});

// Endpoint để kiểm tra xem một IP có đang bị ban không
// Mày sẽ gửi GET request đến: <URL Replit của mày>/api/check-ban?ip=<IP_CẦN_KIỂM_TRA>
// Nếu không truyền IP, sẽ kiểm tra IP của người gửi request này (máy chủ proxy nếu có)
app.get('/api/check-ban', async (req, res) => {
    const ipToCheck = req.query.ip || req.headers['x-forwarded-for'] || req.ip;

    if (!ipToCheck) {
        return res.status(400).json({ error: 'IP cần kiểm tra là bắt buộc hoặc không thể xác định.' });
    }

    try {
        const { data: bannedIps } = await getBannedIpsFromGithub();
        const now = Date.now();

        // Lọc ra các ban còn hiệu lực
        const activeBan = bannedIps.find(ban => 
            ban.ip === ipToCheck && ban.banExpiry && ban.banExpiry > now
        );

        if (activeBan) {
            const timeLeftSeconds = Math.ceil((activeBan.banExpiry - now) / 1000);
            console.log(`[CHECK BAN]: IP ${ipToCheck} đang bị ban. Còn ${timeLeftSeconds}s.`);
            res.status(200).json({ 
                isBanned: true, 
                ip: ipToCheck, 
                reason: activeBan.reason, 
                banExpiry: activeBan.banExpiry,
                timeLeftSeconds: timeLeftSeconds
            });
        } else {
            console.log(`[CHECK BAN]: IP ${ipToCheck} không bị ban.`);
            res.status(200).json({ isBanned: false, ip: ipToCheck });
        }

    } catch (error) {
        console.error(`[API Error]: Xử lý kiểm tra ban IP lỗi:`, error.message);
        res.status(500).json({ error: `Không thể kiểm tra trạng thái ban: ${error.message}` });
    }
});


// Khởi động server
app.listen(port, () => {
  console.log(`HaiGPT API Server (KinAPI) đã sẵn sàng ở cổng ${port}`);
  console.log(`Mở trình duyệt và truy cập URL này để test: ${process.env.REPL_URL || `http://localhost:${port}`}`);
});
