/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   PROCESSADOR — Galeteria Jerusalém                         ║
 * ║   Railway: processa pagamentos + dispara push em background ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Como usar:
 * 1. Crie conta grátis em railway.app
 * 2. Novo projeto → Deploy from GitHub
 * 3. Suba esse arquivo + package.json no GitHub
 * 4. Em Variables, adicione as envs abaixo
 */

const axios = require('axios');

// ── Configurações (variáveis de ambiente do Railway) ──
const MP_ACCESS_TOKEN  = process.env.MP_ACCESS_TOKEN  || 'APP_USR-8448065571541266-031908-0a11102b0c3cc321e2d25e2bc833ace6-3216896322';
const FIREBASE_URL     = process.env.FIREBASE_URL     || 'https://unitv-box-367cc-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_SECRET  = process.env.FIREBASE_SECRET  || '';
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '375c7d29-6611-42a1-9229-753662eccbcb';
const ONESIGNAL_API_KEY= process.env.ONESIGNAL_API_KEY|| 'os_v2_app_g5oh2klgcfbkderjou3gf3glznsvrhfzgfeuxb4agrt7pwxx3rzmaoxewkp4hyofdxmoj5t5uhknabszert5aoz2dn6w4ihpp44hadq';

// ── Helpers Firebase REST ──
function fbAuth(){ return FIREBASE_SECRET ? '?auth=' + FIREBASE_SECRET : ''; }

async function fbGet(path){
  const r = await axios.get(FIREBASE_URL + '/' + path + '.json' + fbAuth());
  return r.data;
}
async function fbPut(path, data){
  await axios.put(FIREBASE_URL + '/' + path + '.json' + fbAuth(), data);
}
async function fbPatch(path, data){
  await axios.patch(FIREBASE_URL + '/' + path + '.json' + fbAuth(), data);
}

// ══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — SERVER-SIDE via OneSignal REST API
// Funciona mesmo com o browser do admin/cliente FECHADO
// ══════════════════════════════════════════════════════════════

const OS_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': 'Key ' + ONESIGNAL_API_KEY
};

// Envia push para o(s) device(s) do ADMIN (tag role=admin)
async function enviarPushAdmin(pedido, pedidoId){
  const nome  = (pedido.usuario && pedido.usuario.nome) ? pedido.usuario.nome : 'Cliente';
  const total = 'R$' + Number(pedido.total || 0).toFixed(2).replace('.', ',');
  const itens = (pedido.itens || []).length;
  const titulo = '\uD83D\uDEF5 Novo Pedido \u2014 ' + total;
  const corpo  = '\uD83D\uDC64 ' + nome + ' \u2022 ' + itens + ' item(s)\nToque para ver o pedido';

  try{
    const r = await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id:           ONESIGNAL_APP_ID,
      filters:          [{ field:'tag', key:'role', relation:'=', value:'admin' }],
      headings:         { pt: titulo, en: titulo },
      contents:         { pt: corpo,  en: corpo  },
      data:             { pedidoId: pedidoId, tipo: 'novo_pedido' },
      collapse_id:      'admin-novo-pedido',
      priority:         10,
      ttl:              3600,
      android_group:    'novos-pedidos',
      ios_badgeType:    'Increase',
      ios_badgeCount:   1
    }, { headers: OS_HEADERS });
    console.log('[PUSH ADMIN] Enviado | recipients: ' + r.data.recipients + ' | pedido: ' + pedidoId.slice(-6));
  }catch(err){
    console.error('[PUSH ADMIN] Erro:', (err.response && err.response.data && err.response.data.errors) || err.message);
  }
}

// Configurações de push por status do pedido
const STATUS_CFG_PUSH = {
  recebido: { titulo: '\uD83D\uDCCB Galeteria Jerusal\u00E9m \u2014 Pedido recebido!',          corpo: '\u25CF \u25CB \u25CB \u25CB  Confirmando seu pedido...' },
  preparo:  { titulo: '\uD83D\uDC68\u200D\uD83C\uDF73 Galeteria Jerusal\u00E9m \u2014 Preparando seu pedido', corpo: '\u25CF \u25CF \u25CB \u25CB  Em preparo \u2022 ~20 min para ficar pronto' },
  saiu:     { titulo: '\uD83D\uDEF5 Galeteria Jerusal\u00E9m \u2014 Pedido saiu para entrega!', corpo: '\u25CF \u25CF \u25CF \u25CB  A caminho \u2022 ~10 min para chegar' },
  entregue: { titulo: '\u2705 Galeteria Jerusal\u00E9m \u2014 Pedido entregue!',                 corpo: '\u25CF \u25CF \u25CF \u25CF  Aproveite! Bom apetite \uD83D\uDE0A' }
};

// Envia push para o CLIENTE dono do pedido via OneSignal
async function enviarPushCliente(pedido, pedidoId, status){
  const cfg = STATUS_CFG_PUSH[status] || STATUS_CFG_PUSH.recebido;

  // Tenta pegar o oneSignalId do pedido, depois do perfil do usuário
  let playerId = pedido.oneSignalId || null;

  if(!playerId && pedido.usuario && pedido.usuario.uid){
    try{
      const userData = await fbGet('usuarios/' + pedido.usuario.uid);
      playerId = (userData && userData.oneSignalId) ? userData.oneSignalId : null;
    }catch(e){}
  }

  if(!playerId){
    // Sem ID OneSignal — salva no Firebase como fallback
    // O app detecta via SSE quando o usuário estiver online
    console.warn('[PUSH CLIENTE] Sem oneSignalId — fallback Firebase | pedido: ' + pedidoId.slice(-6));
    try{
      await fbPatch('pedidos/' + pedidoId + '/pushNotif', {
        titulo: cfg.titulo, corpo: cfg.corpo, status: status, ts: Date.now()
      });
    }catch(e){}
    return;
  }

  try{
    const r = await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id:                    ONESIGNAL_APP_ID,
      include_subscription_uids: [playerId],
      headings:  { pt: cfg.titulo, en: cfg.titulo },
      contents:  { pt: cfg.corpo,  en: cfg.corpo  },
      data:      { status: status, pedidoId: pedidoId },
      collapse_id: 'jer-pedido-' + pedidoId,
      priority:  10,
      ttl:       3600
    }, { headers: OS_HEADERS });

    if(r.data.errors && r.data.errors.length){
      console.warn('[PUSH CLIENTE] OneSignal erros:', r.data.errors);
      // Fallback Firebase
      await fbPatch('pedidos/' + pedidoId + '/pushNotif', {
        titulo: cfg.titulo, corpo: cfg.corpo, status: status, ts: Date.now()
      });
    } else {
      console.log('[PUSH CLIENTE] Enviado | pedido: ' + pedidoId.slice(-6) + ' | status: ' + status + ' | recipients: ' + r.data.recipients);
    }
  }catch(err){
    console.error('[PUSH CLIENTE] Erro:', (err.response && err.response.data && err.response.data.errors) || err.message);
    try{
      await fbPatch('pedidos/' + pedidoId + '/pushNotif', {
        titulo: cfg.titulo, corpo: cfg.corpo, status: status, ts: Date.now()
      });
    }catch(e){}
  }
}

// ══════════════════════════════════════════════════════════════
// MONITOR DE PEDIDOS — detecta novos pedidos e mudanças de status
// Cache em memória: Map<pedidoId, {status, oneSignalId}>
// ══════════════════════════════════════════════════════════════

const _pedidosCache = new Map();
let   _primeiraVerificacao = true;

async function verificarPedidosENotificar(){
  try{
    const pedidos = await fbGet('pedidos');
    if(!pedidos) return;

    for(const [id, pedido] of Object.entries(pedidos)){
      const statusAtual = pedido.status     || 'recebido';
      const oneSignalId = pedido.oneSignalId || null;

      if(!_pedidosCache.has(id)){
        // ── Novo pedido detectado ──
        if(!_primeiraVerificacao){
          // Primeira varredura só inicializa o cache
          // Notifica nas varreduras seguintes
          await enviarPushAdmin(pedido, id);
        }
        _pedidosCache.set(id, { status: statusAtual, oneSignalId: oneSignalId });

      } else {
        // ── Pedido existente: verifica mudança de status ──
        const anterior = _pedidosCache.get(id);
        if(anterior.status !== statusAtual){
          await enviarPushCliente(pedido, id, statusAtual);
          _pedidosCache.set(id, { status: statusAtual, oneSignalId: anterior.oneSignalId || oneSignalId });
        }
        // Atualiza oneSignalId se chegou depois do pedido
        if(oneSignalId && !anterior.oneSignalId){
          _pedidosCache.set(id, { status: statusAtual, oneSignalId: oneSignalId });
        }
      }
    }

    // Remove do cache pedidos que foram apagados do Firebase
    for(const id of _pedidosCache.keys()){
      if(!pedidos[id]) _pedidosCache.delete(id);
    }

    if(_primeiraVerificacao){
      _primeiraVerificacao = false;
      console.log('[MONITOR] Cache inicializado com ' + _pedidosCache.size + ' pedido(s)');
    }
  }catch(err){
    console.error('[MONITOR] Erro ao verificar pedidos:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// PROCESSADOR DE PAGAMENTOS (Mercado Pago)
// ══════════════════════════════════════════════════════════════

async function processarPagamento(pedidoId, dados){
  console.log('[' + new Date().toISOString() + '] Processando pagamento: ' + pedidoId);

  await fbPatch('fila_pagamentos/' + pedidoId, { status: 'processando' });

  try{
    const response = await axios.post('https://api.mercadopago.com/v1/payments', {
      token:              dados.cardToken,
      installments:       dados.installments || 1,
      transaction_amount: dados.total,
      description:        'Galeteria Jerusalem - Pedido #' + pedidoId.slice(-6),
      payment_method_id:  dados.paymentMethodId,
      payment_type_id:    dados.paymentType || 'credit_card',
      issuer_id:          dados.issuerId || undefined,
      payer: {
        email:      dados.email || 'cliente@galeteria.app',
        first_name: dados.nome ? dados.nome.split(' ')[0] : 'Cliente',
        last_name:  dados.nome ? dados.nome.split(' ').slice(1).join(' ') || dados.nome : '',
        identification: { type: 'CPF', number: dados.cpf }
      },
      additional_info: {
        items: (dados.items || []).map(function(i){ return {
          id: i.id || 'item',
          title: i.title || i.name,
          quantity: i.quantity || i.qty,
          unit_price: i.unit_price || i.price
        }; }),
        payer: {
          first_name: dados.nome ? dados.nome.split(' ')[0] : 'Cliente',
          last_name:  dados.nome ? dados.nome.split(' ').slice(1).join(' ') : ''
        }
      },
      external_reference:   pedidoId,
      statement_descriptor: 'Galeteria Jerusalem'
    }, {
      headers: {
        'Authorization':     'Bearer ' + MP_ACCESS_TOKEN,
        'Content-Type':      'application/json',
        'X-Idempotency-Key': pedidoId + '-' + Date.now()
      }
    });

    const pay = response.data;
    console.log('[OK] Pedido ' + pedidoId + ': ' + pay.status + ' / ' + pay.status_detail);

    await fbPatch('fila_pagamentos/' + pedidoId, {
      status:        pay.status,
      status_detail: pay.status_detail,
      mpPaymentId:   pay.id,
      total:         dados.total,
      processadoEm:  Date.now()
    });

    await fbPatch('pedidos/' + pedidoId, {
      statusPagamento: pay.status === 'approved' ? 'aprovado' :
                       (pay.status === 'in_process' || pay.status === 'pending') ? 'em_analise' : 'recusado',
      mpPaymentId: pay.id
    });

  }catch(err){
    const msg = (err.response && err.response.data && err.response.data.message) || err.message || 'Erro desconhecido';
    console.error('[ERRO] Pedido ' + pedidoId + ':', msg);
    await fbPatch('fila_pagamentos/' + pedidoId, {
      status:        'erro',
      status_detail: msg,
      processadoEm:  Date.now()
    });
  }
}

async function verificarFila(){
  try{
    const fila = await fbGet('fila_pagamentos');
    if(!fila) return;

    for(const [pedidoId, dados] of Object.entries(fila)){
      if(dados.status === 'aguardando'){
        const idade = Date.now() - (dados.criadoEm || 0);
        if(idade > 7 * 60 * 1000){
          console.log('[EXPIRADO] Token expirado para pedido ' + pedidoId);
          await fbPatch('fila_pagamentos/' + pedidoId, {
            status:        'expirado',
            status_detail: 'Token do cartão expirou. Tente novamente.'
          });
          continue;
        }
        await processarPagamento(pedidoId, dados);
      }
    }
  }catch(err){
    console.error('[FILA] Erro ao verificar fila:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// LOOP PRINCIPAL
// ══════════════════════════════════════════════════════════════

console.log('Processador Galeteria Jerusalem iniciado!');
console.log('Firebase: ' + FIREBASE_URL);
console.log('MP Token: ' + MP_ACCESS_TOKEN.substring(0, 20) + '...');
console.log('OneSignal App ID: ' + ONESIGNAL_APP_ID);

// Roda imediatamente ao iniciar
verificarFila();
verificarPedidosENotificar();

// Loop: pagamentos a cada 3s, monitor de pedidos a cada 4s
setInterval(verificarFila, 3000);
setInterval(verificarPedidosENotificar, 4000);

// Mantém o processo vivo no Railway
require('http').createServer(function(req, res){
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(
    'Processador Galeteria Jerusalem online\n' +
    'Pedidos em cache: ' + _pedidosCache.size + '\n' +
    'Uptime: ' + Math.floor(process.uptime()) + 's'
  );
}).listen(process.env.PORT || 3000);
