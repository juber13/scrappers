
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();
const app = express();


// import Router
import router from './routes/route.js';

app.use('/api' , router);

// app.listen(process.env.PORT || 5000, () => {
//     console.log(`Server is running on port ${process.env.PORT || 5000}`);
// });
