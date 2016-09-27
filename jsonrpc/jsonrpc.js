module.exports = function(RED) {
  'use strict';
  var rpc = require('json-rpc2');

  function JsonRpcClientNode(n) {
    RED.nodes.createNode(this,n);

    // Configuration options passed by Node Red
    this.host = n.host;
    this.port = parseInt(n.port);
    this.path = n.path;

    // Node state
    var node = this;
    this.client = rpc.Client.$create(this.port, this.host);
    this.conn = this.client.connectSocket(function (err, conn){
      if (err) {
        node.error(RED._('Failed to connect: ' + err.message));
        return;
        // TODO: implement reconnect strategy
      }
      console.log('Client connected');
    });

    this.methodCall = function(method, params, cb) {
      console.log('client calling method: ' + method);
      node.client.call(method, params, cb);
    };
  }

  RED.nodes.registerType('jsonrpc-client', JsonRpcClientNode);

  function JsonRpcCallNode(n) {
    RED.nodes.createNode(this,n);
    this.method = n.method;
    this.client = n.client;
    this.clientConn = RED.nodes.getNode(this.client);

    var node = this;
    if(!this.clientConn) {
      this.error(RED._('missing client config'));
      return;
    }

    this.on('input', function(msg){
      var method = msg.method||node.method;
      var params = [].concat( msg.payload );
      node.clientConn.methodCall(method,params,function(error, value){
        if(error) {
          node.error(RED._(error.message));
          return;
        }
        msg.payload = value;
        node.send(msg);
      });
    });

  }

  RED.nodes.registerType('jsonrpc call', JsonRpcCallNode);

  function JsonRpcServerNode(n) {
    RED.nodes.createNode(this,n);
    var node = this;

    // Configuration options passed by Node Red
    this.host = n.host;
    this.port = parseInt(n.port);

    this.server = rpc.Server.$create();
    this.server.listenRaw(this.port, this.host);
    

    this.listen = function(method, callback) {
      if(node.server.functions[method] !== undefined) {
        node.warn(RED._('The method `' + method + '` is already registered.'));
        return;
      }
      node.server.expose(method, callback);
    };

    this.removeListener = function(method) {
      delete node.server.functions[method];
    };

    this.on('close', function(done){
      if(node.server) {
        process.nextTick(function(){
          node.server.close(function(){
            done();
          });
        });
        
      } else {
        done();
      }
    });

  }

  RED.nodes.registerType('jsonrpc-server', JsonRpcServerNode);

  function JsonRpcListenerNode(n) {
    RED.nodes.createNode(this,n);
    var node = this;
    this.method = n.method;
    this.server = n.server;
    this.serverConn = RED.nodes.getNode(this.server);

    if(!this.serverConn) {
      this.error(RED._('missing server config'));
      return;
    }

    this.serverConn.listen(this.method, function(err, params, cb){
      if(err) {
        node.error(RED._(err.message));
        return;
      }
      var msg = {method: node.method, params: params, _rpc: {cb: cb}};
      node.send(msg);
    });

    this.on('close', function(done){
      if(node.serverConn) {
        node.serverConn.removeListener(node.method);
      }
      done();
    });
  }

  RED.nodes.registerType('jsonrpc listen', JsonRpcListenerNode);

  function JsonRpcResponseNode(n) {
    RED.nodes.createNode(this,n);
    var node = this;

    this.on('input', function(msg){
      if(!msg._rpc || !msg._rpc.cb) {
        node.warn(RED._('Missing rpc callback'));
        return;
      }
      var err = msg.err||null;
      var result = msg.payload;
      msg._rpc.cb(err,result);
    });
  }

  RED.nodes.registerType('jsonrpc response', JsonRpcResponseNode);
};
