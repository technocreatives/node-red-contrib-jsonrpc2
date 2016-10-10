module.exports = function(RED) {
  'use strict';
  var rpc = require('json-rpc2');

  function JsonRpcClientNode(n) {
    RED.nodes.createNode(this,n);

    // Configuration options passed by Node Red
    this.host = n.host;
    this.port = parseInt(n.port);
    this.path = n.path;
    this.connection = n.connection;

    // Node state
    this.connected = false;
    this.connecting = false;
    this.ended = false;
    this.users = {};
    var node = this;

    this.register = function(rpcNode){
      node.users[rpcNode.id] = rpcNode;
      if (Object.keys(node.users).length === 1) {
        node.connect();
      }
    };

    this.deregister = function(rpcNode){
      delete node.users[rpcNode.id];
    };
    
    this.setUserStatus = function(status) {
      for (var id in node.users) {
        if (node.users.hasOwnProperty(id)) {
          node.users[id].status(status);
        }
      }
    };

    var connectionHandler = function(err, conn) {
      if(node.connectionTimer) {
        clearTimeout(node.connectionTimer);
        delete node.connectionTimer;
      }
      node.connecting = false;

      if(err) {
        node.error(RED._('Failed to connect: ' + err.message));
        node.setUserStatus({fill:'red',shape:'dot',text:'disconnected'});

        setTimeout(function(){
          node.connect();
        }, 1000);
        return;
      }
      if(!conn) {
        node.log(RED._('Could not connect. Will retry...'),{host:node.host,port:node.port,connection:node.connection});
        node.setUserStatus({fill:'red',shape:'dot',text:'disconnected'});
        setTimeout(function(){
          node.connect();
        }, 1000);
        return;
      }

      node.log(RED._('Connected'),{host:node.host,port:node.port,connection:node.connection});
      node.connected = true;
      node.conn = conn;
      node.setUserStatus({fill:'green',shape:'dot',text:'connected'});

      conn.on('close', function(err) {
        node.setUserStatus({fill:'red',shape:'dot',text:'disconnected'});
        if(err) {
          node.error(RED._('disconnected: ' + err.message));
        }
        node.log(RED._('disconnected'),{host:node.host,port:node.port,connection:node.connection});
        node.connected = false;
        if(!node.ended){
          node.setUserStatus({fill:'red',shape:'dot',text:'disconnected'});
          setTimeout(function(){
            node.connect();
          }, 1000);
        }
      });
    };

    this.connect = function() {
      if(node.connected || node.connecting || node.ended) {
        return;
      }

      node.setUserStatus({fill:'blue',shape:'dot',text:'connecting'});

      node.client = rpc.Client.$create(node.port, node.host);
      
      switch(this.connection) {
        case 'http': {
          // no connection required
          node.connected = true;
          node.setUserStatus({fill:'green',shape:'dot',text:'connected'});

        }
        break;
        case 'ws': {
          node.connecting = true;
          node.client.connectWebsocket(connectionHandler);
        }
        break;
        case 'socket': {
          node.connecting = true;
          var socketConnection = node.client.connectSocket(connectionHandler);
          this.connectionTimer = setTimeout(function(){
            node.log(RED._('connection timeout'),{host:node.host,port:node.port,connection:node.connection});
            socketConnection.end();
            node.connecting = false;
            node.connect();
          },1000);
        }
      }
    };

    

    this.methodCall = function(method, params, cb) {
      if(!node.connected) {
        return cb(new Error('not connected'), null);
      }
      if(node.connection === 'http') {
        node.client.call(method, params, cb);
      } else {
        if(!node.conn) {
          return cb(new Error('not connected'), null);
        }
        node.conn.call(method, params, cb);
      }
    };

    this.on('close', function(done){
      this.ended = true;
      if(node.connection === 'http' || !node.conn) {
        return done();
      }

      node.conn.end();
      done();

    });

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

    this.clientConn.register(this);

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

    this.on('close', function(done){
      if(node.clientConn) {
        node.clientConn.deregister(node);
        done();
      }
    });

  }

  RED.nodes.registerType('jsonrpc-call', JsonRpcCallNode);

/**
  * TODO: implement server nodes
  *

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

  * --- end server nodes ---
  */
};
