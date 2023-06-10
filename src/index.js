const { parser, Resolver } = require("./templater");

const template = `
#data         
  $hello = 'hello'

  @uno = Al { d = $hello; }
  $s = world <- @uno

  @arguments = Arguments { s = $s; }

  $user_name = name <- @arguments
  $user_incident_id = user_incident_id <- @arguments

  $incident_description_id = 'SD000000'

  @incident = IncidentById { id = $user_incident_id;  name = $user_name; }
  @incident_description = IncidentById { \
    id = $incident_description_id; \
    name = $user_name; \
  }

  $tag = tag <- @incident
  $incident_name = name <- @incident
  $incident_description = description <- @incident_description
  $message = 'hello 234234'

  @potato = Potate { a = $incident_name; b = $incident_description; }

  $work = work <- @potato

//

#view
<Root>
<Mail>
  <H1>{$user_name}</H1>
  <H1>{$user_incident_id}</H1>
  <H1>{$incident_name}</H1>
  <H1>{$incident_description}</H1>
  <H1>{$message}</H1>
</Mail>
</Root>
`;

const result = parser(template);
const resolver = new Resolver();

resolver.registService("Al", (r) => {
  return r.map((x, i) => {
    return {
      world: `Al [world ${i}]`,
    };
  });
});

resolver.registService("IncidentById", (r) => {
  return r.map((x, i) => {
    return {
      tag: `IncidentById tag ${i}`,
      name: `IncidentById name ${i}`,
      description: `IncidentById description ${i}`,
    };
  });
});

resolver.registService("Potate", (r) => {
  return r.map((x, i) => {
    return {
      work: `Potate ${i}`,
    };
  });
});

const res = resolver.buildResolver(result.resolverContext);
res();

// console.log(result);
