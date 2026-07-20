import { WebSocketServer, WebSocket } from 'ws';

import {
  sendMessage,
  toggleReaction,
  reportMessage,
  getActiveMessages,
  getReactionsFor,
  ChatError,
} from './chatService.js';

import {
  registerConnection,
  unregisterConnection,
  touchLastSeen,
  getOnlineCount,
  getSocketsForWallet,
} from './presenceService.js';


const clients = new Set();


function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type,
    ...payload,
  }));
}


function broadcast(type, payload = {}, exclude = null) {

  const message = JSON.stringify({
    type,
    ...payload,
  });


  for (const client of clients) {

    if (client === exclude) continue;

    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}


function serializeMessage(row, reactionsByMessage = {}) {

  return {
    id: row.id,
    wallet: row.wallet,
    message: row.message,
    imagePath: row.image_path,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    reactions: reactionsByMessage[row.id] || [],
  };

}



export function initChatHub(server) {


  const wss = new WebSocketServer({
    server,
    path: '/ws/chat',
  });



  console.log('[CHAT] WebSocket iniciado em /ws/chat');



  wss.on('connection', (ws, req) => {


    console.log(
      '[CHAT] Nova conexão:',
      req.url
    );



    let wallet = null;


    try {

      const url = new URL(
        req.url,
        'http://internal'
      );

      wallet = url.searchParams.get('wallet');

    } catch (err) {

      console.error(
        '[CHAT] URL inválida',
        err
      );

    }


    if (!wallet) {

      console.log(
        '[CHAT] conexão recusada: sem wallet'
      );

      send(
        ws,
        'chat:error',
        {
          code:'WALLET_REQUIRED',
          message:'Connect wallet before joining chat.'
        }
      );

      ws.close();
      return;

    }


    console.log(
      '[CHAT] Wallet conectada:',
      wallet
    );


    ws._wallet = wallet;


    clients.add(ws);


    const wentOnline =
      registerConnection(wallet, ws);


    const activeMessages =
      getActiveMessages();


    const reactions =
      getReactionsFor(
        activeMessages.map(
          m => m.id
        )
      );


    send(
      ws,
      'chat:init',
      {
        messages:
          activeMessages.map(
            m => serializeMessage(m,reactions)
          ),

        onlineCount:
          getOnlineCount()
      }
    );


    if (wentOnline) {

      broadcast(
        'chat:join',
        {
          wallet,
          onlineCount:getOnlineCount()
        },
        ws
      );

    }


    broadcast(
      'chat:presence',
      {
        onlineCount:getOnlineCount()
      }
    );


    ws.on('message',(raw)=>{

      let msg;

      try {

        msg = JSON.parse(
          raw.toString()
        );

      } catch {

        return;

      }

      touchLastSeen(wallet);

      try {

        switch(msg.type){

          case 'chat:send':

            const saved =
              sendMessage({
                wallet,
                message:msg.message,
                imagePath:msg.imagePath,
                replyTo:msg.replyTo || null,
              });

            broadcast(
              'chat:new',
              {
                message:
                  serializeMessage(saved,{})
              }
            );

          break;

          case 'chat:typing':

            broadcast(
              'chat:typing',
              {wallet},
              ws
            );

          break;

          case 'chat:react':

            if(!msg.messageId || !msg.emoji)
              break;

            broadcast(
              'chat:reaction',
              toggleReaction({
                messageId:msg.messageId,
                wallet,
                emoji:msg.emoji
              })
            );

          break;

          case 'chat:report':

            if(!msg.messageId)
              break;

            const result =
              reportMessage({
                messageId:msg.messageId,
                wallet
              });

            if(result.hidden){

              broadcast(
                'chat:hidden',
                {
                  messageId:
                    result.messageId
                }
              );

            }else{

              send(
                ws,
                'chat:reported',
                result
              );

            }

          break;

        }

      } catch(err){

        console.error(
          '[CHAT ERROR]',
          err
        );

        if(err instanceof ChatError){

          send(
            ws,
            'chat:error',
            {
              code:err.code,
              message:err.message
            }
          );

        }else{

          send(
            ws,
            'chat:error',
            {
              code:'INTERNAL_ERROR',
              message:'Something went wrong.'
            }
          );

        }

      }

    });

    ws.on('close',()=>{

      console.log(
        '[CHAT] desconectado:',
        wallet
      );

      clients.delete(ws);

      const wentOffline =
        unregisterConnection(
          wallet,
          ws
        );

      if(wentOffline){

        broadcast(
          'chat:leave',
          {
            wallet,
            onlineCount:getOnlineCount()
          }
        );

      }else{

        broadcast(
          'chat:presence',
          {
            onlineCount:getOnlineCount()
          }
        );

      }

    });

    ws.on('error',(err)=>{

      console.error(
        '[CHAT SOCKET ERROR]',
        wallet,
        err.message
      );

    });

  });

  return wss;

}

export function kickWallet(
  wallet,
  reason='Removed by administrator.'
){

  const sockets =
    getSocketsForWallet(wallet);

  for(const ws of sockets){

    send(
      ws,
      'chat:kicked',
      {
        reason
      }
    );

    ws.close();

  }

  return sockets.length;

}

export function broadcastExpired(messageIds){

  if(!messageIds.length)
    return;

  broadcast(
    'chat:expired',
    {
      messageIds
    }
  );

}
