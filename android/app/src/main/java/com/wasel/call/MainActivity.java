package com.wasel.call;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.wasel.call.plugins.WaselDiscoveryPlugin;

/**
 * Capacitor bridge host for مكالمات واصل.
 *
 * The custom plugin is registered before super.onCreate() as required by
 * Capacitor's plugin registration flow.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WaselDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
