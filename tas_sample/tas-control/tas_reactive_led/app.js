/**
 * Created by ryeubi on 2015-08-31.
 * Updated 2017.03.06
 * Made compatible with Thyme v1.7.2
 */

var net = require('net');
var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');


var wdt = require('./wdt');
// var rgbLib = require('bbb-tcs34725');
var rgb = null;
var { SerialPort } = require('serialport');
var { ReadlineParser } = require('@serialport/parser-readline')
var useparentport = '';
var useparenthostname = '';

var upload_arr = [];
var download_arr = [];
var test_device = '';
var test_service='';
var test_characteristic='';

var characteristic1 = '';
var conf = {};
const { createBluetooth } = require('node-ble');

// This is an async file read
fs.readFile('conf.xml', 'utf-8', function (err, data) {
    if (err) {
        console.log("FATAL An error occurred trying to read in the file: " + err);
        console.log("error : set to default for configuration")
    }
    else {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(data, function (err, result) {
            if (err) {
                console.log("Parsing An error occurred trying to read in the file: " + err);
                console.log("error : set to default for configuration")
            }
            else {
                var jsonString = JSON.stringify(result);
                conf = JSON.parse(jsonString)['m2m:conf'];
                usecomport = conf.tas.comport;
                usebaudrate = conf.tas.baudrate;
                useparenthostname = conf.tas.parenthostname;
                useparentport = conf.tas.parentport;
                // BLE 변수 설정
                test_device = conf.ble.test_device;
                test_service = conf.ble.test_service;
                test_characteristic = conf.ble.test_characteristic;

                if(conf.upload != null) {
                    if (conf.upload['ctname'] != null) {
                        upload_arr[0] = conf.upload;
                    }
                    else {
                        upload_arr = conf.upload;
                    }
                }

                if(conf.download != null) {
                    if (conf.download['ctname'] != null) {
                        download_arr[0] = conf.download;
                    }
                    else {
                        download_arr = conf.download;
                    }
                }
            }
        });
    }
});


var tas_state = 'init';

var upload_client = null;

var t_count = 0;

var tas_download_count = 0;

function on_receive(data) {
    if (tas_state == 'connect' || tas_state == 'reconnect' || tas_state == 'upload') {
        var data_arr = data.toString().split('<EOF>');
        if(data_arr.length >= 2) {
            for (var i = 0; i < data_arr.length - 1; i++) {
                var line = data_arr[i];
                var sink_str = util.format('%s', line.toString());
                var sink_obj = JSON.parse(sink_str);

                if (sink_obj.ctname == null || sink_obj.con == null) {
                    console.log('Received: data format mismatch');
                }
                else {
                    if (sink_obj.con == 'hello') {
                        console.log('Received: ' + line);

                        if (++tas_download_count >= download_arr.length) {
                            tas_state = 'upload';
                        }
                    }
                    else {
                        for (var j = 0; j < upload_arr.length; j++) {
                            if (upload_arr[j].ctname == sink_obj.ctname) {
                                console.log('ACK : ' + line + ' <----');
                                break;
                            }
                        }
                        /* Mobius-> &Cube -> Tas로 받아온 데이터 */
                        for (j = 0; j < download_arr.length; j++) {
                            if (download_arr[j].ctname == sink_obj.ctname) {
                                g_down_buf = JSON.stringify({id: download_arr[i].id, con: sink_obj.con});
                                console.log(g_down_buf + ' <----');
                                //myPort.write(g_down_buf);
                                console.log("con print : "+sink_obj.con);
                                control_led(sink_obj.con); // LED 제어
            
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}
var myPort = null;
function tas_watchdog() {
    if(tas_state == 'init') {
        upload_client = new net.Socket();

        upload_client.on('data', on_receive);

        upload_client.on('error', function(err) {
            console.log(err);
            tas_state = 'reconnect';
        });

        upload_client.on('close', function() {
            console.log('Connection closed');
            upload_client.destroy();
            tas_state = 'reconnect';
        });

        if(upload_client) {
            console.log('tas init ok');
            tas_state = 'init_ble';
        }
    }
    else if(tas_state == 'init_ble') {
        ble_connect();
        tas_state = 'init_serial';
    }
    else if(tas_state == 'init_serial') {

        myPort = new SerialPort({
            path : usecomport, 
            baudRate : parseInt(usebaudrate, 10),
            // buffersize : 1
        });
        console.log(usecomport+" 시리얼 포트 연결 완료");

        var parser = new ReadlineParser();
        myPort.pipe(parser);
        parser.on('data', setRGB);
        myPort.on('open', showPortOpen);
        //parser.on('data', saveLastestData);
       // myPort.on('data',setRGB);
        myPort.on('close', showPortClose);
        myPort.on('error', showError);
        
        if(myPort) {
            console.log('tas init serial ok');
            tas_state = 'connect';
        }
    }
    else if(tas_state == 'connect' || tas_state == 'reconnect') {
        upload_client.connect(useparentport, useparenthostname, function() {
            console.log('upload Connected');
            tas_download_count = 0;
            for (var i = 0; i < download_arr.length; i++) {
                console.log('download Connected - ' + download_arr[i].ctname + ' hello');
                var cin = {ctname: download_arr[i].ctname, con: 'hello'};
                upload_client.write(JSON.stringify(cin) + '<EOF>');
            }
            if (tas_download_count >= download_arr.length) {
                tas_state = 'upload';
            }
        });
    }
    // else if (tas_state=='upload') {
    //     saveLastestData();
    //     //rgb.on('ready',saveLastestData);
    // }
}


//wdt.set_wdt(require('shortid').generate(), 2, timer_upload_action);
wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

var cur_c = '';
var pre_c = '';
var g_sink_buf = '';
var g_sink_ready = [];
var g_sink_buf_start = 0;
var g_sink_buf_index = 0;
var g_down_buf = '';


async function ble_connect(){ // BLE 연결
    const { bluetooth, destroy } = createBluetooth();

    // get bluetooth adapter
    const adapter = await bluetooth.defaultAdapter();
    await adapter.startDiscovery();
    console.log('BLE>> discovering');

    // get device and connect
    const device = await adapter.waitDevice(test_device);
    console.log('got device', await device.getAddress(), await device.getName());
    await device.connect(); // 기기 연결
    console.log('BLE>> connected');

    const gattServer = await device.gatt();

    // read write characteristic
    const service1 = await gattServer.getPrimaryService(test_service) // 서비스 설정
    characteristic1 = await service1.getCharacteristic(test_characteristic) // 캐릭터 설정
    console.log('BLE>> set characteristic ok')
    characteristic1.writeValue(Buffer.from(hexStringToByteArray("0211ff3c3c3c3c03")));
    console.log("첫 제어")
}

var cct=0,illu=0;

function setRGB(data){
    //console.log(data);
    var split = data.split(',');
    cct = split[1];
    illu = split[2];

    /** 보정 */
    cct = Math.round(0.948599 * cct + -371.397);
    illu = Math.round(0.095954 * illu + 139.1128);
    console.log("sensor value : cct/"+cct+", lux/"+illu);
    var upload_data_cct = cct+"/"+illu;
    upload_action_cct(upload_data_cct);
}
// function measure_rgb() {

//     var rgbc = rgb.getRawData(function(err,colors){ // r,g,b,c
//         if (err) throw err;
      
//         r=colors.red;
//         g=colors.green;
//         b=colors.blue;
//         c=colors.clear;
//         console.log(r+" "+g+" "+b+" "+c+" "); 

        
//      })
     
//     cct = rgb.calculateColorTemperature(function(err, temp) { // cct
//         if (err) throw err;
//         cct=Math.floor(temp);

        
//     })
    
//     illu = rgb.calculateLux(function(err, lux) { // lux
//       if (err) throw err;
//       illu=Math.floor(lux);
      
//       console.log('sensor value : '+"r/"+r+",g/"+g+",b/"+b+",c/"+c+",cct/"+cct+",lux/"+illu);
//       //create_send_packet(r,g,b,c,cct,illu);
      
//     })
    
// }

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

// var target_cct = 0;
// var target_illu = 0;
var ch_2700_index = 60;
var ch_4500_index = 60;
var ch_5700_index = 60;
var ch_6500_index = 60;

function control_led(data){
    var target_cct = parseInt(get_target_cct_illu(data)[0]); // 목표 색온도
    var target_illu = parseInt(get_target_cct_illu(data)[1]);  // 목표 조도

    tune_led(target_cct, target_illu);
}

var margin_of_error = 10; // 오차범위(%)
var cct_margin_of_error_min;
var cct_margin_of_error_max;
var illu_margin_of_error_min;
var illu_margin_of_error_max;

async function tune_led(target_cct, target_illu){
    var env_cct = 0;
    var env_illu = 0;
    var cct_diff;
    var value = 20; // 증감값

    console.log("목표 색온도 : "+target_cct+", 목표 조도 : "+target_illu);
    
    /** 목표 색온도 2700K ~ 4500K */
    if(target_cct >= 2700 & target_cct < 4500){
        
        /** 오차 범위 설정 */
        set_margin_of_error(target_cct, target_illu);
        
        while(true){
            // measure_rgb(); // RGB 측정
            await sleep(1000);
            env_cct = cct;
            env_illu = illu;
            console.log("현재 색온도 : "+env_cct+", 현재 조도 : "+env_illu);
            
            
            /** 오차 범위 내에 들어왔을 경우 종료 */
            if(check_cct_illu(env_cct, env_illu)){
                console.log("제어 완료!");
                break;
            }

            /** 목표 색온도와 주변 색온도의 차이 */
            cct_diff = Math.abs(target_cct - env_cct)

            /** 조도 UP 색온도 UP */
            if(env_cct < target_cct & env_illu <= target_illu){
                if(cct_diff <= 1000){
                    
                    ch_4500_up(value);
                }
                else if(cct_diff > 1000 & cct_diff <= 2000){
                    ch_5700_up(value);
                }
                else{
                    ch_6500_up(value);
                }
            }

            /** 조도 UP 색온도 DOWN */
            if(env_cct > target_cct & env_illu <= target_illu){
                ch_2700_up(value);
            }

            /** 조도 DOWN 색온도 UP */
            if(env_cct < target_cct & env_illu > target_illu){
                ch_2700_down(value);
            }

            /** 조도 DOWN 색온도 DOWN */
            if(env_cct > target_cct & env_illu > target_illu){
                if(cct_diff <= 1000){
                    if(ch_4500_index >= value){
                        ch_4500_down(value);
                    }
                        
                    else {
                        if(ch_5700_index >= value){
                        ch_5700_down(value);
                        }
                        else{
                            ch_6500_down(value);
                        }
                    }
                   
                }
                else if(cct_diff > 1000 & cct_diff <= 2000){
                    if(ch_5700_index >= value){
                        ch_5700_down(value);
                    }else{
                        if(ch_6500_index >= value){
                            ch_6500_down(value);
                        }else{
                            ch_4500_down(value);
                        }
                    }
                    
                }
                else{
                    ch_6500_down(value);
                }
            }
        }

    }

    /** 목표 색온도 4500K ~ 5700K */
    if(target_cct >= 4500 & target_cct < 5700){
        /** 오차 범위 설정 */
        set_margin_of_error(target_cct, target_illu);
            
        while(true){
            //measure_rgb(); // RGB 측정
            await sleep(2000);
            env_cct = cct;
            env_illu = illu;
            console.log("현재 색온도 : "+env_cct+", 현재 조도 : "+env_illu);
        
            /** 오차 범위 내에 들어왔을 경우 종료 */
            if(check_cct_illu(env_cct, env_illu)){
                console.log("제어 완료!");
                break;
            }

            /** 목표 색온도와 주변 색온도의 차이 */
            cct_diff = Math.abs(target_cct - env_cct)

            /** 조도 UP 색온도 UP */
            if(env_cct < target_cct & env_illu <= target_illu){
                if(cct_diff <= 1000){
                    ch_5700_up(value);
                    set_led_packet()
                }
                else{
                    ch_6500_up(value);
                }
            }

            /** 조도 UP 색온도 DOWN */
            if(env_cct > target_cct & env_illu <= target_illu){
                if(cct_diff <= 1000){
                    ch_4500_up(value);
                }
                else{
                    ch_2700_up(value);
                }
            }

            /** 조도 DOWN 색온도 UP */
            if(env_cct < target_cct & env_illu > target_illu){
                if(cct_diff <= 1000){
                    if(ch_4500_index >= value){
                        ch_4500_down(value);
                    }
                    else{
                        ch_2700_down(value);
                    }

                }
                else{
                    if(ch_2700_index >= value){
                        ch_2700_down(value);
                    }
                    else{
                        ch_4500_index(value);
                    }
                }
            }

            /** 조도 DOWN 색온도 DOWN */
            if(env_cct > target_cct & env_illu > target_illu){
                if(cct_diff <= 1000){
                    ch_4500_down(value);
                }
                else{
                    ch_2700_down(value);
                }
            }
        }
  

    } 

    /** 목표 색온도 5700K ~ 6500K */
    if(target_cct >= 5700 & target_cct <= 6500){
        
        /** 오차 범위 설정 */
        set_margin_of_error(target_cct, target_illu);

        while(true){
            //measure_rgb(); // RGB 측정
            await sleep(2000);
            env_cct = cct;
            env_illu = illu;
            
            /** 오차 범위 내에 들어왔을 경우 종료 */
            if(check_cct_illu(env_cct, env_illu)){
                console.log("제어 완료!");
                break;
            }

            /** 목표 색온도와 주변 색온도의 차이 */
            cct_diff = Math.abs(target_cct - env_cct)

            /** 조도 UP 색온도 UP */
            if(env_cct < target_cct & env_illu <= target_illu){
                ch_6500_up(value);
            }

            /** 조도 UP 색온도 DOWN */
            if(env_cct > target_cct & env_illu < target_illu){
                if(cct_diff >= 1000){
                    ch_2700_up(value);
                }
                else if(cct_diff >= 500 & cct_diff < 1000){
                    ch_4500_up(value);
                }
                else{
                    ch_5700_up(value)
                }
            }

            /** 조도 DOWN 색온도 UP */
            if(env_cct < target_cct & env_illu >= target_illu){
                if(cct_diff >= 1000){
                    if(ch_2700_index >= value){
                        ch_2700_down(value);
                    }else{
                        if(ch_4500_index >= value){
                            ch_4500_down(value);
                        }else{
                            ch_5700_down(value);
                        }
                    }
                    
                }
                else if(cct_diff >= 500 & cct_diff < 1000){
                    if(ch_4500_index >= value){
                        ch_4500_down(value);
                    }else{
                        if(ch_5700_index>=value){
                            ch_5700_down(value);
                        }
                        else{
                            ch_2700_down(value);
                        }
                    }
                    
                }
                else{
                    if(ch_5700_index >= value){
                        ch_5700_down(value)
                    }
                    else{
                        if(ch_4500_index >= value){
                            ch_4500_down(value);
                        }else{
                            ch_2700_down(value);
                        }
                    }
                }
            }

            /** 조도 DOWN 색온도 DOWN */
            if(env_cct > target_cct & env_illu > target_illu){
                ch_6500_down(value);
            }
        }

    } 
}


function set_margin_of_error(target_cct, target_illu){
    cct_margin_of_error_min = target_cct - (target_cct * (margin_of_error / 100));
    cct_margin_of_error_max = target_cct + (target_cct * (margin_of_error / 100));
    illu_margin_of_error_min = target_illu - (target_illu * (margin_of_error / 100));
    illu_margin_of_error_max = target_illu + (target_illu * (margin_of_error / 100));
}

function check_cct_illu(env_cct, env_illu){
    if((env_cct >= cct_margin_of_error_min & env_cct <= cct_margin_of_error_max)
    &(env_illu >= illu_margin_of_error_min & env_illu <= illu_margin_of_error_max)){
        console.log("오차 범위 내 들어옴")
        return true;
    }
    else {
        console.log("오차 범위 밖임")
        return false;
    }
    
}

function get_target_cct_illu(data){
    var split = data.split("/");
    cct = split[0];
    illu = split[1];
    var arr = [cct,illu];
    return arr;
}


function upload_action(data){
    if(tas_state == 'upload'){
        var cin = {ctname:'cnt-channel', con : data};
        console.log(JSON.stringify(cin) + ' ---->');
        upload_client.write(JSON.stringify(cin) + '<EOF>');
    }
}

function upload_action_cct(data){
    if(tas_state == 'upload'){
        var cin = {ctname:'cnt-reactive-cct', con : data};
        console.log(JSON.stringify(cin) + ' ---->');
        upload_client.write(JSON.stringify(cin) + '<EOF>');
    }
}


function ch_2700_up(num){
    ch_2700_index += num;
    send_led_packet(set_led_packet())
}

function ch_2700_down(num){
    ch_2700_index -= num;
    send_led_packet(set_led_packet())
}

function ch_4500_up(num){
    ch_4500_index += num;
    send_led_packet(set_led_packet())
}

function ch_4500_down(num){
    ch_4500_index -= num;
    send_led_packet(set_led_packet())
}

function ch_5700_up(num){
    ch_5700_index += num;
    send_led_packet(set_led_packet())
}

function ch_5700_down(num){
    ch_5700_index -= num;
    send_led_packet(set_led_packet())
}

function ch_6500_up(num){
    ch_6500_index += num;
    send_led_packet(set_led_packet())
}

function ch_6500_down(num){
    ch_6500_index -= num;
    send_led_packet(set_led_packet())
}


function set_led_packet(){
    var padding = '00';
    var ch_2700_index_hex =ch_2700_index.toString(16).padStart(2,'0');
    var ch_4500_index_hex =ch_4500_index.toString(16).padStart(2,'0');
    var ch_5700_index_hex =ch_5700_index.toString(16).padStart(2,'0');
    var ch_6500_index_hex =ch_6500_index.toString(16).padStart(2,'0');

    var packet = "0211ff" + ch_4500_index_hex + ch_6500_index_hex + ch_2700_index_hex + ch_5700_index_hex+"03";
    console.log(packet);
    return packet;
}

function hexStringToByteArray(hexString) {
    if (hexString.length % 2 !== 0) {
        throw "BLE>> Must have an even number of hex digits to convert to bytes";
    }
    var numBytes = hexString.length / 2;
    var byteArray = new Uint8Array(numBytes);
    for (var i=0; i<numBytes; i++) {
        byteArray[i] = parseInt(hexString.substr(i*2, 2), 16);
    }
    return byteArray;
}

function send_led_packet(led_packet){
    characteristic1.writeValue(Buffer.from(hexStringToByteArray(led_packet)));
    console.log('BLE>> set LED : '+led_packet);
    var upload_data =ch_4500_index + "/" +ch_6500_index + "/"+ch_2700_index + "/"+ch_5700_index;
    upload_action(upload_data);
    
}

function create_send_packet(r,g,b,c,cct,illu)
{
    send_packet="r/"+r+",g/"+g+",b/"+b+",c/"+c+",cct/"+cct+",lux/"+illu;
    console.log('send_packet : '+send_packet);
    upload_action(send_packet);
}

function showPortOpen() {
    console.log('port open.');
}

function showPortClose() {
    console.log('port closed.');
}

function showError(error) {
    var error_str = util.format("%s", error);
    console.log(error.message);
    if (error_str.substring(0, 14) == "Error: Opening") {

    }
    else {
        console.log('SerialPort port error : ' + error);
    }
}

