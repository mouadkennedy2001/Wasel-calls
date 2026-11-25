package com.wasel.call.plugins;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Small native helper for LAN discovery.
 *
 * The WebView cannot open UDP sockets, so the web app asks this plugin for
 * the network it is actually attached to. It can later be extended with a
 * DatagramSocket based broadcast without changing the JavaScript API.
 */
@CapacitorPlugin(name = "WaselDiscovery")
public class WaselDiscoveryPlugin extends Plugin {

    private static final String TAG = "WaselDiscovery";
    private static final int DISCOVERY_PORT = 7789;
    private volatile DatagramSocket discoverySocket;
    private volatile Thread discoveryThread;
    private volatile boolean discoveryRunning;
    private final Map<String, HostInfo> hosts = new LinkedHashMap<>();
    private final String deviceId = UUID.randomUUID().toString().replace("-", "").substring(0, 24);

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (discoveryRunning) {
            call.resolve();
            return;
        }
        discoveryRunning = true;
        try {
            DatagramSocket socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress("0.0.0.0", DISCOVERY_PORT));
            discoverySocket = socket;
            discoveryThread = new Thread(this::discoveryLoop, "wasel-discovery");
            discoveryThread.start();
            call.resolve();
        } catch (SocketException exception) {
            discoveryRunning = false;
            call.reject("Discovery unavailable", exception);
        }
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        discoveryRunning = false;
        if (discoverySocket != null) {
            discoverySocket.close();
            discoverySocket = null;
        }
        hosts.clear();
        call.resolve();
    }

    @PluginMethod
    public void getHosts(PluginCall call) {
        call.resolve(buildHostsObject());
    }

    private void discoveryLoop() {
        DatagramSocket socket = discoverySocket;
        if (socket == null) return;
        long lastPing = 0;
        byte[] buffer = new byte[4096];
        while (discoveryRunning && !socket.isClosed()) {
            long now = System.currentTimeMillis();
            if (now - lastPing > 4000) {
                broadcastPing(socket);
                lastPing = now;
            }
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            try {
                socket.setSoTimeout(1000);
                socket.receive(packet);
                onDiscoveryPacket(packet);
            } catch (java.io.IOException ignored) {
                // Timeout is expected; it lets the loop broadcast periodically.
            }
        }
    }

    private void broadcastPing(DatagramSocket socket) {
        try {
            JSONObject packet = new JSONObject();
            packet.put("a", "wasel-call");
            packet.put("v", 1);
            packet.put("t", "ping");
            packet.put("id", deviceId);
            packet.put("n", Build.MODEL);
            packet.put("h", "");
            packet.put("p", 7788);
            packet.put("u", 7790);
            packet.put("net", "");
            packet.put("ts", System.currentTimeMillis());
            byte[] bytes = packet.toString().getBytes("UTF-8");
            DatagramPacket datagram = new DatagramPacket(bytes, bytes.length,
                    InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT);
            socket.send(datagram);
        } catch (Exception ignored) {
            // LAN broadcast can be blocked; manual host remains available.
        }
    }

    private void onDiscoveryPacket(DatagramPacket packet) {
        try {
            String raw = new String(packet.getData(), packet.getOffset(), packet.getLength(), "UTF-8");
            JSONObject message = new JSONObject(raw);
            if (!"wasel-call".equals(message.optString("a"))
                    || message.optInt("v") != 1
                    || !"pong".equals(message.optString("t"))) return;
            long ts = message.optLong("ts", 0);
            if (Math.abs(System.currentTimeMillis() - ts) > 60000) return;
            String hostId = message.optString("h");
            int port = message.optInt("p", 7788);
            if (hostId.isEmpty() || port <= 0 || port >= 65536) return;
            String address = packet.getAddress().getHostAddress();
            HostInfo host = new HostInfo(
                    hostId,
                    message.optString("n", "Wasel Host"),
                    address,
                    port,
                    message.optString("net", "")
            );
            hosts.put(hostId, host);
            notifyListeners("waselHosts", buildHostsObject());
        } catch (Exception ignored) {
            // Ignore malformed discovery packets.
        }
    }

    private JSObject buildHostsObject() {
        JSObject result = new JSObject();
        JSONArray peers = new JSONArray();
        JSONArray hostArray = new JSONArray();
        long now = System.currentTimeMillis();
        hosts.entrySet().removeIf(entry -> now - entry.getValue().seen > 15000);
        for (HostInfo host : hosts.values()) {
            JSObject peer = new JSObject();
            peer.put("id", host.id);
            peer.put("name", host.name);
            peer.put("network", host.network);
            peer.put("port", host.port);
            peers.put(peer);

            JSObject hostObject = new JSObject();
            hostObject.put("id", host.id);
            hostObject.put("hostId", host.id);
            hostObject.put("name", host.name);
            hostObject.put("address", host.address);
            hostObject.put("port", host.port);
            hostObject.put("network", host.network);
            hostArray.put(hostObject);
        }
        result.put("peers", peers);
        result.put("hosts", hostArray);
        return result;
    }

    private static class HostInfo {
        final String id;
        final String name;
        final String address;
        final int port;
        final String network;
        final long seen;

        HostInfo(String id, String name, String address, int port, String network) {
            this.id = id;
            this.name = name;
            this.address = address;
            this.port = port;
            this.network = network;
            this.seen = System.currentTimeMillis();
        }
    }

    @PluginMethod
    public void getWifiInfo(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();

        String ssid = "";
        String interfaceType = "none";
        String localIp = "";

        ConnectivityManager connectivity =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);

        if (connectivity != null) {
            Network network = connectivity.getActiveNetwork();
            if (network != null) {
                NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
                if (capabilities != null) {
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        interfaceType = "wifi";
                    } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                        interfaceType = "ethernet";
                    } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                        interfaceType = "cellular";
                    }

                    LinkProperties links = connectivity.getLinkProperties(network);
                    localIp = firstIPv4(links);
                }
            }

            // Fallback: inspect every available network if the active one
            // did not expose a usable address.
            if (localIp.isEmpty()) {
                for (Network candidate : connectivity.getAllNetworks()) {
                    String ip = firstIPv4(connectivity.getLinkProperties(candidate));
                    if (!ip.isEmpty()) {
                        localIp = ip;
                        break;
                    }
                }
            }
        }

        boolean canReadSsid = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean hasLocation = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            boolean hasNearby = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && context.checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES)
                    == PackageManager.PERMISSION_GRANTED;
            canReadSsid = hasLocation || hasNearby;
        }

        if (canReadSsid) {
            try {
                WifiManager wifi = (WifiManager) context.getApplicationContext()
                        .getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    WifiInfo info = wifi.getConnectionInfo();
                    if (info != null) {
                        String rawSsid = info.getSSID();
                        if (rawSsid != null
                                && !rawSsid.isEmpty()
                                && !"<unknown ssid>".equalsIgnoreCase(rawSsid)) {
                            ssid = rawSsid.replaceAll("^\"|\"$", "");
                        }
                        if (localIp.isEmpty()) {
                            localIp = intToIp(info.getIpAddress());
                        }
                    }
                }
            } catch (SecurityException exception) {
                // Android 13+ can still deny the read at runtime. Return an
                // empty SSID rather than failing the whole plugin call.
                Log.w(TAG, "SSID read denied: " + exception.getMessage());
                ssid = "";
            }
        }

        result.put("ssid", ssid);
        result.put("interfaceType", interfaceType);
        result.put("type", interfaceType);
        result.put("localIp", localIp);
        result.put("ip", localIp);
        call.resolve(result);
    }

    private static String firstIPv4(LinkProperties links) {
        if (links == null) {
            return "";
        }
        for (LinkAddress address : links.getLinkAddresses()) {
            InetAddress inetAddress = address.getAddress();
            if (inetAddress instanceof Inet4Address && !inetAddress.isLoopbackAddress()) {
                return inetAddress.getHostAddress();
            }
        }
        return "";
    }

    private static String intToIp(int address) {
        if (address == 0) {
            return "";
        }
        return (address & 0xFF) + "."
                + ((address >> 8) & 0xFF) + "."
                + ((address >> 16) & 0xFF) + "."
                + ((address >> 24) & 0xFF);
    }
}
