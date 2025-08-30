import 'dotenv/config'
import express from 'express'
import { clerkMiddleware } from '@clerk/express'
import { Server } from 'socket.io'
import cookie from "cookie"
import { verifyToken } from '@clerk/express'
import { createServer } from 'node:http'
import { Redis } from '@upstash/redis'

const app = express()
const PORT = 3001
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { 
    origin: 'http://localhost:3000',
    allowedHeaders: true,
    methods: ["GET","POST"],
    credentials: true
  },
})

// ✅ connect to Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// 🔒 Clerk auth middleware for sockets
io.use(async (socket, next) => {
  try {
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie)
      const token = cookies['__session']
      const session = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
      socket.data.user_id = session.sub
    } else {
      throw new Error("unauthorized")
    }
    next()
  } catch (err) {
    next(err)
  }
})

io.on("connection", async (socket) => {
  const userId = socket.data.user_id
  if (!userId) return

  // mark online in Redis
  //user presence login

  //emit users status to all listners on join
  await redis.set(`user:status:${userId}`, true)
  socket.join(userId)
   io.to(userId).emit("online:status:"+userId, {
      userId,
      online: true,
    })
//join a user status
  socket.on("join:status", async (targetId, callback) => {
    socket.join(targetId)
    const status = await redis.get(`user:status:${targetId}`)
    const isOnline = status === "true" || status === true
    io.to(targetId).emit("online:status:"+targetId, {
      targetId,
      online: isOnline
    })
  })

//update and emit the user status
  socket.on("update:status", async (data) => {
    await redis.set(`user:status:${userId}`, data)
    io.to(userId).emit("online:status:"+userId, {
      userId,
      online: data
    })
  })

    //chat room logic
    socket.on("join:chat",(data)=>{
      socket.join(data)
    })
  socket.on("send:chat:message",(data)=>{
   io.to(data.chat_id).emit(`chat:message:${data.chat_id}`,data)
  })

  socket.on("chat:input:focus",(data)=>{
    io.to(data).emit("chat:input:focus:"+data,socket.data.user_id)
  })
  
  socket.on("chat:input:blur",(data)=>{
    io.to(data).emit("chat:input:blur:"+data,socket.data.user_id)
  })
  socket.on("disconnect", async () => {
    await redis.set(`user:status:${userId}`, false)

    io.to(userId).emit("online:status:"+userId, {
      userId,
      online: false,
    })
  })
})

app.use(clerkMiddleware())

app.get('/', (req, res) => {
  res.send("Hello world")
})

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
})
