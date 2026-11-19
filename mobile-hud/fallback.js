// fallback engine stub
module.exports={cooldowns:new Map(),isCooling(m){const t=this.cooldowns.get(m);return !!t&&Date.now()<t;},cool(m,ms){this.cooldowns.set(m,Date.now()+ms);}};
