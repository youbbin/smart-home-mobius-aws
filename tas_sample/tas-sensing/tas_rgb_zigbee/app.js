/**
 * Created by ryeubi on 2015-08-31.
 * Updated 2017.03.06
 * Made compatible with Thyme v1.7.2
 */

var net = require('net');
var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');
var exec = require("child_process").exec;
// var SerialPort = require('serialport').SerialPort;
// var xbee_api = require('xbee-api');
// var C = xbee_api.constants;
var wdt = require('./wdt');

var { SerialPort } = require('serialport');
var { ReadlineParser } = require('@serialport/parser-readline')

var usecomport = '';
var usebaudrate = '';
var useparentport = '';
var useparenthostname = '';

var upload_arr = [];
var download_arr = [];

var conf = {};
var xbeeAPI = new xbee_api.XBeeAPI({
    api_mode: 1
  });

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

                        for (j = 0; j < download_arr.length; j++) {
                            if (download_arr[j].ctname == sink_obj.ctname) {
                                g_down_buf = JSON.stringify({id: download_arr[i].id, con: sink_obj.con});
                                console.log(g_down_buf + ' <----');
                                
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}



var serialport = null;
var xbeeAPI = null;
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
            tas_state = 'init_serial';
        }
    }
    else if(tas_state == 'init_serial') {
        // xbeeAPI = new xbee_api.XBeeAPI({
        //     api_mode: 1
        //   });
        // console.log("Xbee 설정 완료");
        // serialport = new SerialPort({
        //     path : usecomport,
        //     baudRate: parseInt(usebaudrate, 10)
        // });
        // console.log(usecomport+" 시리얼 포트 연결 완료");
        // serialport.pipe(xbeeAPI.parser);
        // xbeeAPI.builder.pipe(serialport);
        // console.log("시리얼 포트에 Xbee 연결 완료");
         
        // // xbee 데이터 받기
        // xbeeAPI.parser.on("data", function(frame) {
        //     let frame_data = frame.data.toString();
        //     if(frame_data != undefined){
        //         console.log(frame_data);
        //         saveLastestData(frame_data);
        //     }
            
        // });
        // console.log("Xbee 데이터 받기 설정 완료");
        // tas_state = 'connect';

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
}

wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

var cur_c = '';
var pre_c = '';
var g_sink_buf = '';
var g_sink_ready = [];
var g_sink_buf_start = 0;
var g_sink_buf_index = 0;
var g_down_buf = '';

function saveLastestData(data) {
    console.log("xbee 데이터 받음");
    var json = JSON.parse(data);
    console.log("Buffer -> JSON 변환 완료 :"+json);
    upload_action(json)
}

function upload_action(data){
    if(tas_state == 'upload'){
        var cin = {ctname:'cnt-rgb-zigbee', con : data};
        console.log(JSON.stringify(cin) + ' ---->');
        upload_client.write(JSON.stringify(cin) + '<EOF>');
    }
}
var cct = 0, illu = 0;

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