const { parser, createResolver } = require("./templater");

const template = `
#data         
  $hello = 'hello'

  @uno = Al { d = $hello; }
  $s = world <- @uno

  $huba = $s
  

  @arguments = Arguments { s = $s; }

  $check_servcie_arguments = value <- @arguments

  $value = 'hello \
  world'

  $user_name = name <- @arguments
  $user_incident_id = user_incident_id <- @arguments

  $incident_description_id = 'SD000000'

  $muli_text = '\
    hello \
    world \
  '

  @incident = IncidentById { id = $user_incident_id;  name = $user_name; }
  @incident_description = IncidentById { \
    id = $incident_description_id; \
    name = $user_name; \
  }

  @left = Left { id = $user_name; }
  @right = Right { id = $user_name; }
  $left = left <- @left
  $right = right <- @right

  $tag = tag <- @incident
  $incident_name = name <- @incident
  $incident_description = description <- @incident_description
  $message = 'hello 234234'

  @potato = Potate { a = $incident_name; b = $incident_description; }

  $work = work <- @potato

  @jira = Jira { dep = $work; }
  @pot = Potate { dep = $work; }

  $valure = case <- @jira
  $valure_tow = case <- @pot

//

#view(title)[default]
Инцидент {{incident_name}}

#view(body_html)[default]
<html>
 <body>
  <h1>{{incident_name}}</h1>
  <P>{{huba}}</P>
  <Value>{{value}}</Value>
  <Check>{{check_servcie_arguments}}</Check>
  {{muli_text}}
 </body>
</html>
`;

{
  /* <Root>
<Mail>
  <H1>{$user_name}</H1>
  <H1>{$user_incident_id}</H1>
  <H1>{$incident_name}</H1>
  <H1>{$incident_description}</H1>
  <H1>{$message}</H1>
  
</Mail>
</Root> */
}

const resolver = createResolver();

// const timeolog = (time, message) =>
//   new Promise((res) => {
//     setTimeout(() => console.log(message, res()), time);
//   });

resolver.registService("Al", async (r) => {
  // throw new Error()
  // console.log(r);
  // await timeolog(1000, "Al");
  return r.map((x, i) => {
    return {
      world: `Al [world ${i}]`,
    };
  });
});

resolver.registService("IncidentById", async (r) => {
  // await timeolog(1000, "IncidentById");
  // throw new Error();
  return r.map((x, i) => {
    return {
      tag: `IncidentById tag ${i}`,
      name: `IncidentById name ${i}`,
      description: `IncidentById description ${i}`,
    };
  });
});

resolver.registService("Potate", async (r) => {
  // throw new Error();
  // await timeolog(1000, "Potate");
  return r.map((x, i) => {
    return {
      work: `Potate ${i}`,
    };
  });
});

resolver.registService("Jira", async (r) => {
  // await timeolog(1000, "Jira");
  return r.map((x, i) => {
    return {
      case: `case ${i}`,
    };
  });
});

resolver.registService("Left", async (r) => {
  // await timeolog(1000, "Left");
  return r.map((x, i) => {
    return {
      left: `It is left variable ${i}`,
    };
  });
});

resolver.registService("Right", async (r) => {
  // throw new Error()
  // await timeolog(1000, "Right");
  return r.map((x, i) => {
    return {
      right: `It is right variable ${i}`,
    };
  });
});

const renderer = resolver.buildRenderer();
renderer(template, ["title", "body_html"], {
  args: {
    check_servcie_arguments: "it is work",
  },
}).then((message) => console.log(message));
