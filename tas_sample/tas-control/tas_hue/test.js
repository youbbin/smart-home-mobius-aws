
var request = require('request');
var userid = "bGrTbuVoNJSmjqadzDfxUqZjB1Imd0LoGWCPAPXA"
var option_state = {
    url : "http://192.168.100.61/api/"+userid+"/lights"
}

var option_put = {
    url : "http://192.168.100.61/api/"+userid+"/lights/3/state",
    body :{
            on : false
    },
    json:true 
    
}

// request.get(option_state, function(err,response,body){
//     console.log(JSON.parse(body))
// })
request.put(option_put, function(err,response,body){
    console.log(response.statusCode);
    console.log(body);
})