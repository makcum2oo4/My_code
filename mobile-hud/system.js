const os=require('os');
module.exports={metrics(){return {ram:Math.round((1-os.freemem()/os.totalmem())*100),cpu:os.loadavg()[0].toFixed(2),disk:'n/a'};}};
