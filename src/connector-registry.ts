export type ConnectorInstallation = "available" | "installed" | "disabled";
export type ConnectorAuthentication = "on_install" | "on_use" | "none";

export type ConnectorDescriptor = {
  connectorId: string;
  target: string;
  transport: "mcp-stdio" | "plugin-manifest" | "http" | "connector-contract";
  capabilities: string[];
  installation: ConnectorInstallation;
  authentication: ConnectorAuthentication;
};

export type ConnectorSelection = {
  target: string;
  requiredCapabilities: string[];
};

export type ConnectorRegistry = {
  list(): ConnectorDescriptor[];
  select(input: ConnectorSelection): ConnectorDescriptor;
};

export function createConnectorRegistry(connectors: ConnectorDescriptor[]): ConnectorRegistry {
  const ordered = [...connectors];
  return {
    list(): ConnectorDescriptor[] {
      return [...ordered];
    },

    select(input: ConnectorSelection): ConnectorDescriptor {
      const connector = ordered.find(
        (candidate) =>
          candidate.target === input.target &&
          candidate.installation !== "disabled" &&
          input.requiredCapabilities.every((capability) =>
            candidate.capabilities.includes(capability),
          ),
      );
      if (!connector) {
        throw new Error(`No connector satisfies target ${input.target}`);
      }
      return connector;
    },
  };
}
