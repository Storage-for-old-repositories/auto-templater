export declare type VariableType = "ref" | "type";

interface InternalVariable<T extends VariableType> {
  type: T;
}

interface InternalEntity {
  name: string;
}

export declare interface VariableRef extends InternalVariable<"ref"> {
  service: string;
  fieldKey: string;
}
export declare interface VariableConst extends InternalVariable<"const"> {
  constant: string;
}

export declare interface Dependency extends InternalEntity {
  variableName: string;
}

export declare interface Service extends InternalEntity {
  dependencies: Dependency[];
}

type SyncOrAsync<T> = T | Promise<T>;

type ResolverAvailableTypes = string | string[] | undefined;

export declare type ResolverArgs = Record<string, ResolverAvailableTypes>;

export declare type Resolver = (
  context: ResolverArgs[]
) => SyncOrAsync<ResolverAvailableTypes[]>;
